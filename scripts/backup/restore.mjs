import { lstat, mkdtemp, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import {
  absolutePath,
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
} from "./common.mjs";

const restoreFailure = new MaintenanceError(
  "restore-failed",
  "Restore failed. Keep the target out of service and use a new, empty recovery database before retrying.",
);
const badArchive = new MaintenanceError(
  "archive-invalid",
  "Select a completed KhanCoal backup and provide its trusted SHA-256 and recovery identity.",
);
const badTarget = new MaintenanceError(
  "target-not-empty",
  "Restore requires an empty recovery database owned by a restricted migration login.",
);

async function verifyTarget(client) {
  const {
    rows: [checks],
  } = await client.query(
    `SELECT (d.datdba = r.oid AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole) AS restricted_owner,
       NOT EXISTS (
         SELECT 1 FROM pg_namespace n
         WHERE n.nspname <> 'public' AND n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'
       ) AND NOT EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       ) AND NOT EXISTS (
         SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace WHERE n.nspname = 'public'
       ) AND NOT EXISTS (
         SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
       ) AS empty
     FROM pg_database d CROSS JOIN pg_roles r
     WHERE d.datname = current_database() AND r.rolname = current_user`,
  );
  if (!checks?.restricted_owner || !checks.empty) throw badTarget;
}

async function verifyRestoredData(client) {
  const {
    rows: [identity],
  } = await client.query(
    `SELECT (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text AS migrations,
       EXISTS (SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS migration_failed,
       EXISTS (SELECT 1 FROM public.users WHERE role_code = 'OWNER' AND is_active) AS has_owner,
       ${omittedData.map((name) => `EXISTS (SELECT 1 FROM public.${name})`).join(" OR ")} AS contains_excluded_data`,
  );
  if (
    identity.migrations === "0" ||
    identity.migration_failed ||
    !identity.has_owner ||
    identity.contains_excluded_data
  ) {
    throw new MaintenanceError(
      "verification-failed",
      "The restored database failed migration, Owner, or secret-exclusion checks. Keep the target out of service.",
    );
  }
  const {
    rows: [totals],
  } = await client.query(
    `SELECT (SELECT count(*) FROM public.orders)::text AS orders,
       (SELECT count(*) FROM public.payments)::text AS payments,
       count(*)::text AS "ledgerEntries",
       COALESCE(sum(amount) FILTER (WHERE customer_id IS NOT NULL), 0)::text AS "customerJournalTotal",
       COALESCE(sum(amount) FILTER (WHERE supplier_id IS NOT NULL), 0)::text AS "supplierJournalTotal"
     FROM public.ledger_entries`,
  );
  return { migrations: identity.migrations, ...totals };
}

async function run() {
  const [
    configPath,
    targetDatabase,
    archiveArg,
    expectedHash,
    identityArg,
    scratchArg,
  ] = process.argv.slice(2);
  if (!/^[a-f\d]{64}$/i.test(expectedHash)) throw badArchive;
  const config = await readConfig(configPath);
  if (
    config.database !== targetDatabase ||
    ["postgres", "template0", "template1"].includes(config.database)
  )
    throw badTarget;
  const archive = absolutePath(archiveArg);
  const name = path.basename(archive);
  const identity = absolutePath(identityArg);
  if (
    !archiveName.test(name) ||
    !(await lstat(archive)).isFile() ||
    !(await lstat(identity)).isFile()
  )
    throw badArchive;

  const client = managedDatabase(config);
  const connection = new AbortController();
  const started = Date.now();
  const deadline = AbortSignal.timeout(config.timeoutMs);
  const signal = AbortSignal.any([connection.signal, deadline]);
  const actor = auditActor();
  const restoreId = jobId();
  let workingDirectory;
  let stableArchive;
  let loaded = false;
  client.on("error", () => connection.abort());
  try {
    await client.connect();
    const {
      rows: [lock],
    } = await client.query(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [backupLock],
    );
    if (!lock.acquired)
      throw new MaintenanceError(
        "already-running",
        "Another backup or restore is in progress.",
        2,
      );
    await verifyTarget(client);

    // Hold a copy in the administrator's private workspace to restore the exact
    // bytes verified against the Owner's independently recorded digest.
    workingDirectory = await mkdtemp(
      path.join(await existingDirectory(scratchArg), "khancoal-restore-"),
    );
    stableArchive = path.join(workingDirectory, name);
    await copyArchive(archive, stableArchive, signal);
    if ((await sha256(stableArchive, signal)) !== expectedHash.toLowerCase())
      throw badArchive;

    // pg_dump explicitly selects public and recreates it. Remove only the
    // bootstrap schema in the verified empty target. RESTRICT protects any
    // objects installed since the empty-database check.
    await client.query("DROP SCHEMA IF EXISTS public RESTRICT");
    await relayPrograms(
      program(config, "age", [
        "--decrypt",
        "--identity",
        identity,
        stableArchive,
      ]),
      program(config, "pg_restore", [
        ...connectionArgs(config),
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--no-tablespaces",
        "--no-security-labels",
      ]),
      signal,
      ({ converted }) =>
        converted
          ? restoreFailure
          : new MaintenanceError(
              "decryption-failed",
              "The archive could not be decrypted. Check the separate age recovery identity.",
            ),
    );
    loaded = true;
    const totals = await verifyRestoredData(client);
    const verification = {
      archiveId: name,
      elapsedMs: Date.now() - started,
      ...totals,
    };
    await audit(
      client,
      actor,
      "backup.restore",
      restoreId,
      "SUCCESS",
      verification,
    );
    console.log(JSON.stringify(verification));
  } catch (error) {
    if (loaded) {
      const failureCode =
        error instanceof MaintenanceError ? error.code : restoreFailure.code;
      await audit(client, actor, "backup.restore", restoreId, "FAILURE", {
        archiveId: name,
        failureCode,
      }).catch(() => {});
    }
    if (deadline.aborted) {
      throw new MaintenanceError(
        "deadline-exceeded",
        "The restore exceeded its deadline. Keep the target out of service.",
      );
    }
    throw error;
  } finally {
    if (stableArchive) await rm(stableArchive, { force: true }).catch(() => {});
    if (workingDirectory) await rmdir(workingDirectory).catch(() => {});
    await client.end().catch(() => {});
  }
}

try {
  await run();
} catch (error) {
  displayFailure(error, restoreFailure);
}
