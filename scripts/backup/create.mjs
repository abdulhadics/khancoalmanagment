import { lstat, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  archiveName,
  audit,
  auditActor,
  backupLock,
  connectionArgs,
  copyArchive,
  displayFailure,
  existingDirectory,
  jobId,
  MaintenanceError,
  managedDatabase,
  omittedData,
  program,
  readConfig,
  relayPrograms,
  sha256,
  transaction,
} from "./common.mjs";
import { mirrorEncryptedArchive } from "./object-mirror.mjs";

const dumpFailure = new MaintenanceError(
  "dump-failed",
  "PostgreSQL could not produce the backup. Check the backup login, database grants, and client version.",
);
const encryptFailure = new MaintenanceError(
  "encryption-failed",
  "The backup could not be encrypted. Check age, its recipient, and the archive directory.",
);
const workerFailure = new MaintenanceError(
  "worker-failed",
  "The backup failed. Check the database connection, backup account, and archive directory.",
);
const timeoutFailure = new MaintenanceError(
  "deadline-exceeded",
  "The backup exceeded its deadline and stopped before completing.",
);

async function startJob(client, actor) {
  const id = jobId();
  return transaction(client, async () => {
    const interrupted = await client.query(
      `UPDATE public.backups
       SET state = 'FAILED', failure_code = 'worker-interrupted', completed_at = GREATEST(now(), started_at)
       WHERE state = 'RUNNING' RETURNING id`,
    );
    const systemActor = auditActor();
    for (const job of interrupted.rows) {
      await audit(client, systemActor, "backup.create", job.id, "FAILURE", {
        failureCode: "worker-interrupted",
      });
    }
    const result = await client.query(
      `INSERT INTO public.backups (id, source, actor_id, state)
       SELECT $1::uuid, $2::public.backup_source, $3::uuid, 'RUNNING'
       WHERE $3 IS NULL OR EXISTS (
         SELECT 1 FROM public.users WHERE id = $3 AND is_active AND role_code = 'OWNER'
       )`,
      [id, actor.id ? "MANUAL" : "SCHEDULED", actor.id],
    );
    if (!result.rowCount) return null;
    return id;
  });
}

async function finishJob(client, actor, id, archive, failureCode) {
  await transaction(client, async () => {
    if (archive) {
      await client.query(
        `UPDATE public.backups SET state = 'SUCCEEDED', completed_at = GREATEST(now(), started_at),
           archive_id = $2, archive_hash = $3, byte_count = $4
         WHERE id = $1 AND state = 'RUNNING'`,
        [id, archive.name, archive.hash, archive.size],
      );
      await audit(client, actor, "backup.create", id, "SUCCESS", {
        archiveId: archive.name,
        byteCount: archive.size,
        mirror: archive.mirror,
        objectMirror: archive.objectMirror,
      });
      return;
    }
    await client.query(
      `UPDATE public.backups SET state = 'FAILED', failure_code = $2, completed_at = GREATEST(now(), started_at)
       WHERE id = $1 AND state = 'RUNNING'`,
      [id, failureCode],
    );
    await audit(client, actor, "backup.create", id, "FAILURE", { failureCode });
  });
}

function archiveStamp(value) {
  return value.toISOString().replaceAll(/[-:.]/g, "");
}

async function pruneArchives(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && archiveName.test(entry.name))
    .map((entry) => entry.name);
  names.sort().reverse();
  const recent = archiveStamp(new Date(Date.now() - 48 * 60 * 60 * 1000));
  const days = new Set();
  const months = new Set();
  for (const name of names) {
    const stamp = archiveName.exec(name)[1];
    const day = stamp.slice(0, 8);
    const month = stamp.slice(0, 6);
    const daily = days.size < 30 && !days.has(day);
    const monthly = months.size < 12 && !months.has(month);
    if (daily) days.add(day);
    if (monthly) months.add(month);
    if (!daily && !monthly && stamp < recent)
      await rm(path.join(directory, name));
  }
}

async function removeInterruptedWrites(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".partial") &&
      archiveName.test(entry.name.slice(0, -8))
    ) {
      await rm(path.join(directory, entry.name));
    }
  }
}

async function mirrorArchive(directory, source, archive, signal) {
  let partial;
  try {
    const target = await existingDirectory(directory);
    if (target.toLowerCase() === path.dirname(source).toLowerCase())
      return "failed";
    await removeInterruptedWrites(target);
    const final = path.join(target, archive.name);
    partial = `${final}.partial`;
    const copySignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    await copyArchive(source, partial, copySignal);
    if ((await sha256(partial, copySignal)) !== archive.hash) return "failed";
    await rename(partial, final);
    await pruneArchives(target);
    return "succeeded";
  } catch {
    return "failed";
  } finally {
    if (partial) await rm(partial, { force: true }).catch(() => {});
  }
}

async function makeArchive(config, directory, id, signal) {
  const name = `khancoal-${archiveStamp(new Date())}-${id.replaceAll("-", "")}.dump.age`;
  const destination = path.join(directory, name);
  const partial = `${destination}.partial`;
  try {
    await relayPrograms(
      program(config, "pg_dump", [
        ...connectionArgs(config),
        "--format=custom",
        "--schema=public",
        "--strict-names",
        "--no-privileges",
        "--no-tablespaces",
        "--no-security-labels",
        "--lock-wait-timeout=15000",
        ...omittedData.map((table) => `--exclude-table-data=public.${table}`),
      ]),
      program(config, "age", [
        "--encrypt",
        "--recipient",
        config.ageRecipient,
        "--output",
        partial,
      ]),
      signal,
      ({ converted }) => (converted ? encryptFailure : dumpFailure),
    );
    const { size } = await lstat(partial);
    if (!size) throw encryptFailure;
    const hash = await sha256(partial, signal);
    signal.throwIfAborted();
    await rename(partial, destination);
    return { name, hash, size };
  } finally {
    await rm(partial, { force: true }).catch(() => {});
  }
}

async function run() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "actor-id": { type: "string" },
      "request-id": { type: "string" },
      "ip-address": { type: "string" },
    },
  });
  const config = await readConfig(values.config, true);
  const actor = auditActor(
    values["actor-id"],
    values["request-id"],
    values["ip-address"],
  );
  const client = managedDatabase(config);
  const connection = new AbortController();
  client.on("error", () => connection.abort());
  try {
    await client.connect();
    const {
      rows: [lock],
    } = await client.query(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [backupLock],
    );
    if (!lock.acquired) {
      throw new MaintenanceError(
        "already-running",
        "Another backup or restore is in progress. Retry after it finishes.",
        2,
      );
    }
    const id = await startJob(client, actor);
    if (!id)
      throw new MaintenanceError(
        "owner-required",
        "An active Owner account is required for manual backup.",
      );
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const signal = AbortSignal.any([connection.signal, deadline]);
    try {
      const directory = await existingDirectory(config.archiveDirectory);
      await removeInterruptedWrites(directory);
      const archive = await makeArchive(config, directory, id, signal);
      archive.mirror = config.mirrorDirectory
        ? await mirrorArchive(
            config.mirrorDirectory,
            path.join(directory, archive.name),
            archive,
            signal,
          )
        : "not-configured";
      archive.objectMirror = config.objectMirror
        ? actor.id
          ? "scheduled-only"
          : await mirrorEncryptedArchive(
              config.objectMirror,
              path.join(directory, archive.name),
              archive,
              signal,
            )
        : "not-configured";
      await finishJob(client, actor, id, archive);
      await pruneArchives(directory).catch(() =>
        console.error(
          "The backup succeeded. Review archive retention and filesystem access.",
        ),
      );
      if (archive.mirror === "failed")
        console.error(
          "The primary backup succeeded. Check the optional mirror destination.",
        );
      if (archive.objectMirror === "failed") {
        console.error(
          "The primary backup succeeded. The cloud copy could not be verified.",
        );
        process.exitCode = 3;
      }
      console.log(archive.name);
    } catch (error) {
      const failure = deadline.aborted
        ? timeoutFailure
        : error instanceof MaintenanceError
          ? error
          : workerFailure;
      await finishJob(client, actor, id, null, failure.code).catch(() => {});
      throw failure;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

try {
  await run();
} catch (error) {
  displayFailure(error, workerFailure);
}
