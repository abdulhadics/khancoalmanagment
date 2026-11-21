import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import pg from "pg";

export const archiveName = /^khancoal-(\d{8}T\d{9}Z)-[a-f0-9]{32}\.dump\.age$/;
export const backupLock = "3091736130";

export const omittedData = [
  "user_credentials",
  "sessions",
  "auth_challenges",
  "rate_limit_buckets",
  "idempotency_keys",
  "backups",
];

export class MaintenanceError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function failConfiguration() {
  return new MaintenanceError(
    "configuration",
    "Check the protected maintenance configuration file and required settings.",
  );
}

export function absolutePath(value) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    /[\0\r\n]/.test(value)
  ) {
    throw failConfiguration();
  }
  return path.normalize(value);
}

export async function existingDirectory(value) {
  const directory = absolutePath(value);
  if (!(await lstat(directory)).isDirectory()) throw failConfiguration();
  return realpath(directory);
}

export async function readConfig(configPath, backup = false) {
  let config;
  try {
    config = JSON.parse(await readFile(absolutePath(configPath), "utf8"));
  } catch {
    throw failConfiguration();
  }
  if (
    !config ||
    !["127.0.0.1", "::1"].includes(config.host) ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    typeof config.database !== "string" ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(config.database) ||
    typeof config.user !== "string" ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(config.user)
  )
    throw failConfiguration();

  const timeoutSeconds = config.timeoutSeconds ?? 1800;
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 15 ||
    timeoutSeconds > 3600
  ) {
    throw failConfiguration();
  }
  const settings = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    postgresBin: absolutePath(config.postgresBin),
    ageExecutable: absolutePath(config.ageExecutable),
    passwordFile: absolutePath(config.passwordFile),
    timeoutMs: timeoutSeconds * 1000,
  };
  if (!backup) return settings;
  if (
    !/^age1(?:pq1)?[023456789acdefghjklmnpqrstuvwxyz]{58,2000}$/.test(
      config.ageRecipient,
    )
  ) {
    throw failConfiguration();
  }
  return {
    ...settings,
    ageRecipient: config.ageRecipient,
    archiveDirectory: absolutePath(config.archiveDirectory),
    mirrorDirectory: config.mirrorDirectory
      ? absolutePath(config.mirrorDirectory)
      : undefined,
  };
}

export function jobId() {
  return randomUUID();
}

export function auditActor(actorId, requestId, ipAddress) {
  if (
    (actorId !== undefined &&
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(actorId)) ||
    (requestId !== undefined && !/^[\w.-]{1,128}$/.test(requestId)) ||
    (ipAddress !== undefined && !isIP(ipAddress))
  )
    throw failConfiguration();
  return {
    id: actorId ?? null,
    type: actorId ? "USER" : "SYSTEM",
    requestId: requestId ?? jobId(),
    ipAddress: ipAddress ?? null,
  };
}

export async function audit(client, actor, action, targetId, outcome, after) {
  await client.query(
    `INSERT INTO public.audit_logs (
       actor_id, actor_type, area, action, target_type, target_id, request_id,
       ip_address, outcome, after
     ) VALUES ($1, $2, 'administration', $3, 'backup', $4, $5, $6, $7, $8)`,
    [
      actor.id,
      actor.type,
      action,
      targetId,
      actor.requestId,
      actor.ipAddress,
      outcome,
      after,
    ],
  );
}

export function managedDatabase(config) {
  // libpq and node-postgres both use PGPASSFILE. The path is protected by the
  // maintenance account's Windows ACL. No password passes through arguments.
  delete process.env.PGPASSWORD;
  process.env.PGPASSFILE = config.passwordFile;
  return new pg.Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    ssl: false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    statement_timeout: 15_000,
    application_name: "khancoal-maintenance",
  });
}

export async function transaction(client, callback) {
  await client.query("BEGIN");
  try {
    const result = await callback();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export function connectionArgs(config) {
  return [
    "--no-password",
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--username=${config.user}`,
    `--dbname=${config.database}`,
  ];
}

export function program(config, tag, args) {
  const command =
    tag === "age"
      ? config.ageExecutable
      : path.join(config.postgresBin, `${tag}.exe`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SYSTEMROOT|WINDIR|PATH|TEMP|TMP)$/i.test(key),
    ),
  );
  return {
    command,
    args,
    env: {
      ...env,
      PGPASSFILE: config.passwordFile,
      PGSSLMODE: "disable",
      PGCONNECT_TIMEOUT: "10",
    },
  };
}

function runProgram(spec, signal, stdio) {
  const child = spawn(spec.command, spec.args, {
    windowsHide: true,
    env: spec.env,
    signal,
    stdio,
  });
  child.stderr?.resume();
  const exit = new Promise((resolve) => {
    let failedToStart = false;
    child.once("error", () => {
      failedToStart = true;
    });
    child.once("close", (code) => resolve(code === 0 && !failedToStart));
  });
  return { child, exit };
}

export async function relayPrograms(producer, consumer, signal, makeError) {
  const source = runProgram(producer, signal, ["ignore", "pipe", "pipe"]);
  const destination = runProgram(consumer, signal, ["pipe", "ignore", "pipe"]);
  const relay = pipeline(source.child.stdout, destination.child.stdin, {
    signal,
  }).then(
    () => true,
    () => false,
  );
  const [converted, accepted, delivered] = await Promise.all([
    source.exit,
    destination.exit,
    relay,
  ]);
  if (!converted || !accepted || !delivered)
    throw makeError({ converted, accepted });
}

export async function sha256(file, signal) {
  const hash = createHash("sha256");
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(createReadStream(file), sink, { signal });
  return hash.digest("hex");
}

export function copyArchive(source, destination, signal) {
  return pipeline(
    createReadStream(source),
    createWriteStream(destination, { flags: "wx" }),
    { signal },
  );
}

export function displayFailure(error, fallback) {
  const problem = error instanceof MaintenanceError ? error : fallback;
  console.error(problem.message);
  process.exitCode = problem.exitCode;
}
