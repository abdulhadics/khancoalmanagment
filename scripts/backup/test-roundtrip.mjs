import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import pg from "pg";

import { archiveName, backupLock, sha256 } from "./common.mjs";

const runFile = promisify(execFile);

async function run(command, args, env) {
  try {
    return {
      ...(await runFile(command, args, {
        env,
        timeout: 120_000,
        windowsHide: true,
      })),
      code: 0,
    };
  } catch (error) {
    if (typeof error.code === "number")
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    throw new Error(`Could not run ${path.basename(command)}.`);
  }
}

async function connect(url, databaseName) {
  const database = new URL(url);
  database.pathname = `/${databaseName}`;
  const client = new pg.Client({
    connectionString: database.toString(),
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

async function seedSource(client) {
  const {
    rows: [owner],
  } = await client.query(
    "INSERT INTO users (username, email, display_name, role_code) VALUES ('backup-owner', 'backup-owner@example.test', 'Backup test', 'OWNER') RETURNING id",
  );
  const {
    rows: [customer],
  } = await client.query(
    "INSERT INTO customers (code, name, name_key, created_by_id, updated_by_id) VALUES ('DRILL', 'Drill Buyer', 'drill buyer', $1, $1) RETURNING id",
    [owner.id],
  );
  const {
    rows: [voucher],
  } = await client.query(
    `INSERT INTO payments (voucher_no, ordinal, business_date, customer_id, direction, method, amount, document_profile_id, created_by_id, status)
     SELECT 'RCV-000001', 1, '2024-06-05', $1, 'IN', 'CASH', 51.25, document_profile_id, $2, 'POSTED' FROM company_settings RETURNING id`,
    [customer.id, owner.id],
  );
  await client.query(
    `INSERT INTO ledger_entries (kind, business_date, customer_id, amount, actor_id) VALUES ('CUSTOMER_OPENING','2024-05-02',$1,219.99,$2)`,
    [customer.id, owner.id],
  );
  await client.query(
    `INSERT INTO ledger_entries (kind, business_date, customer_id, amount, actor_id, payment_id)
     VALUES ('CUSTOMER_RECEIPT','2024-06-05',$1,-51.25,$2,$3)`,
    [customer.id, owner.id, voucher.id],
  );
  await client.query(
    "INSERT INTO user_credentials (user_id,password_hash,must_change_password) VALUES ($1,$2,false)",
    [owner.id, randomBytes(32).toString("hex")],
  );
  const {
    rows: [session],
  } = await client.query(
    "INSERT INTO sessions (user_id,token_digest,expires_at) VALUES ($1,$2,now() + interval '1 hour') RETURNING id",
    [owner.id, randomBytes(32).toString("hex")],
  );
  return { userId: owner.id, sessionId: session.id, roleCode: "OWNER" };
}

async function downloadAsOwner(sourceUrl, sourceClient, actor, configPath) {
  process.env.KHANCOAL_BACKUP_CONFIG = configPath;
  process.env.DEPLOYMENT_ENV = "development";
  let database;
  try {
    const { makePrisma } = await import("../../src/server/db/connect.ts");
    const { createBackupDownload } =
      await import("../../src/server/admin/backups.ts");
    database = makePrisma(sourceUrl.toString());
    const response = await createBackupDownload(database, actor, {
      requestId: "owner-download-test",
    });
    assert.match(response.name, archiveName);
    const bytes = Buffer.from(
      await new Response(response.stream).arrayBuffer(),
    );
    assert.equal(BigInt(bytes.length), response.size);
    assert.match(
      bytes.subarray(0, 24).toString("ascii"),
      /^age-encryption\.org\/v1\n/,
    );
    const {
      rows: [job],
    } = await sourceClient.query(
      "SELECT archive_hash FROM backups WHERE archive_id = $1 AND source = 'MANUAL' AND actor_id = $2 AND state = 'SUCCEEDED'",
      [response.name, actor.userId],
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      job.archive_hash,
    );
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    const reason = [
      "ERR_UNKNOWN_FILE_EXTENSION",
      "ERR_MODULE_NOT_FOUND",
      "unconfigured",
      "busy",
      "failed",
    ].includes(error?.code)
      ? ` (${error.code})`
      : "";
    assert.fail(`The Owner manual backup download failed${reason}.`);
  } finally {
    await database?.$disconnect();
    delete process.env.KHANCOAL_BACKUP_CONFIG;
  }
}

async function recoverOwner(targetUrl, target) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/recover-restored-owner.ts",
      target,
      "backup-owner",
    ],
    {
      env: { ...process.env, DATABASE_URL: targetUrl.toString() },
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  child.stdin.end(`${randomBytes(24).toString("base64url")}\n`);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, "Restore access to the original Owner");
}

async function drill(adminUrl, pgBin, ageBin) {
  const admin = await connect(adminUrl, "postgres");
  const tag = randomBytes(5).toString("hex");
  const source = `khancoal_${tag}_source`;
  const target = `khancoal_${tag}_restore`;
  const backupRole = `khancoal_${tag}_backup`;
  const migrationRole = `khancoal_${tag}_migration`;
  const backupPassword = randomBytes(24).toString("hex");
  const migrationPassword = randomBytes(24).toString("hex");
  const root = await mkdtemp(path.join(tmpdir(), "khancoal archive drill "));
  const backupConfig = path.join(root, "backup config.json");
  const restoreConfig = path.join(root, "restore config.json");
  const archiveDirectory = path.join(root, "archives");
  const mirrorDirectory = path.join(root, "mirror");
  const identityPath = path.join(root, "identity.txt");
  const passwordFile = path.join(root, "pgpass.conf");
  const ipAddress = "127.0.0.1";
  const port = Number(adminUrl.port || 5432);
  const postgresCommand = path.join(pgBin, "psql.exe");
  const connectionArguments = [
    "--host=127.0.0.1",
    `--port=${port}`,
    "--no-password",
    "--no-psqlrc",
  ];
  const powershell = path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const shellArguments = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"];
  let sourceClient;
  let targetClient;
  try {
    await mkdir(archiveDirectory);
    await mkdir(mirrorDirectory);
    assert.equal(
      (await run(path.join(ageBin, "age-keygen.exe"), ["-o", identityPath]))
        .code,
      0,
      "Create an ephemeral test key",
    );
    const publicKey = (await readFile(identityPath, "utf8")).match(
      /# public key: (age\S+)/,
    )?.[1];
    assert.ok(publicKey, "Read the test recipient");

    await admin.query(
      `CREATE ROLE ${backupRole} LOGIN PASSWORD '${backupPassword}'`,
    );
    await admin.query(
      `CREATE ROLE ${migrationRole} LOGIN PASSWORD '${migrationPassword}'`,
    );
    await admin.query(`CREATE DATABASE ${source} TEMPLATE template0`);
    await admin.query(
      `CREATE DATABASE ${target} TEMPLATE template0 OWNER ${migrationRole}`,
    );
    await writeFile(
      passwordFile,
      [
        `${ipAddress}:${port}:${source}:${backupRole}:${backupPassword}`,
        `${ipAddress}:${port}:${target}:${migrationRole}:${migrationPassword}`,
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );

    const sourceUrl = new URL(adminUrl);
    sourceUrl.pathname = `/${source}`;
    const migrate = await run(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        ...process.env,
        DATABASE_URL: sourceUrl.toString(),
        MIGRATION_DATABASE_URL: sourceUrl.toString(),
      },
    );
    assert.equal(migrate.code, 0, "Migrate source fixture");
    const grants = await run(
      postgresCommand,
      [
        ...connectionArguments,
        `--username=${decodeURIComponent(adminUrl.username)}`,
        `--dbname=${source}`,
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `backup_role=${backupRole}`,
        "-f",
        "scripts/grant-backup-access.sql",
      ],
      { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) },
    );
    assert.equal(grants.code, 0, "Apply the real backup role grants");

    sourceClient = await connect(adminUrl, source);
    const actor = await seedSource(sourceClient);
    const { userId: actorId } = actor;
    const {
      rows: [granted],
    } = await sourceClient.query(
      "SELECT has_table_privilege($1, 'public.user_credentials', 'SELECT') AS secret, has_table_privilege($1, 'public.orders', 'UPDATE') AS writes",
      [backupRole],
    );
    assert.deepEqual(granted, { secret: false, writes: false });
    const settings = {
      ageExecutable: path.join(ageBin, "age.exe"),
      passwordFile,
      host: ipAddress,
      port,
      postgresBin: pgBin,
    };
    const backupSettings = {
      ...settings,
      database: source,
      user: backupRole,
      archiveDirectory,
      mirrorDirectory,
      ageRecipient: publicKey,
    };
    await writeFile(backupConfig, JSON.stringify(backupSettings));
    await writeFile(
      restoreConfig,
      JSON.stringify({ ...settings, database: target, user: migrationRole }),
    );

    const backupArgs = [
      ...shellArguments,
      "scripts/backup.ps1",
      "-ConfigPath",
      backupConfig,
      "-ActorId",
      actorId,
      "-RequestId",
      "backup-roundtrip",
      "-IpAddress",
      ipAddress,
    ];
    await sourceClient.query("SELECT pg_advisory_lock($1::bigint)", [
      backupLock,
    ]);
    try {
      const busy = await run(powershell, backupArgs);
      assert.equal(
        busy.code,
        2,
        `Reject concurrent backup jobs. ${busy.stderr}`,
      );
    } finally {
      await sourceClient.query("SELECT pg_advisory_unlock($1::bigint)", [
        backupLock,
      ]);
    }
    const backup = await run(powershell, backupArgs);
    assert.equal(backup.code, 0, `Create encrypted archive. ${backup.stderr}`);
    const archiveId = backup.stdout.trim();
    assert.match(archiveId, archiveName);
    const archive = path.join(archiveDirectory, archiveId);
    const digest = await sha256(archive);
    assert.equal(
      await sha256(path.join(mirrorDirectory, archiveId)),
      digest,
      "Mirror the verified encrypted bytes",
    );
    const {
      rows: [stored],
    } = await sourceClient.query(
      "SELECT source, state, actor_id, archive_hash FROM backups WHERE archive_id = $1",
      [archiveId],
    );
    assert.deepEqual(stored, {
      source: "MANUAL",
      state: "SUCCEEDED",
      actor_id: actorId,
      archive_hash: digest,
    });
    const {
      rows: [backupAudit],
    } = await sourceClient.query(
      "SELECT actor_id, outcome FROM audit_logs WHERE action = 'backup.create' AND request_id = 'backup-roundtrip'",
    );
    assert.deepEqual(backupAudit, { actor_id: actorId, outcome: "SUCCESS" });
    await downloadAsOwner(sourceUrl, sourceClient, actor, backupConfig);

    if (process.env.TEST_RCLONE_EXECUTABLE) {
      const remote = path.join(root, "object-mirror");
      const configFile = path.join(root, "rclone.conf");
      await writeFile(
        configFile,
        `[qa]\ntype = alias\nremote = ${remote.replaceAll("\\", "/")}\n`,
      );
      const objectMirror = {
        executable: process.env.TEST_RCLONE_EXECUTABLE,
        configFile,
        remotePath: "qa:backup/daily",
      };
      const scheduledArgs = [
        ...shellArguments,
        "scripts/backup.ps1",
        "-ConfigPath",
        backupConfig,
      ];
      await writeFile(
        backupConfig,
        JSON.stringify({ ...backupSettings, objectMirror }),
      );
      const mirrored = await run(powershell, scheduledArgs);
      assert.equal(mirrored.code, 0, mirrored.stderr);
      const mirroredId = mirrored.stdout.trim();
      assert.match(mirroredId, archiveName);
      assert.equal(
        await sha256(path.join(remote, "backup", "daily", mirroredId)),
        await sha256(path.join(archiveDirectory, mirroredId)),
      );

      objectMirror.executable = path.join(root, "missing-rclone.exe");
      await writeFile(
        backupConfig,
        JSON.stringify({ ...backupSettings, objectMirror }),
      );
      const failed = await run(powershell, scheduledArgs);
      assert.equal(failed.code, 3, failed.stderr);
      const retainedId = failed.stdout.trim();
      assert.match(retainedId, archiveName);
      const { rows } = await sourceClient.query(
        `
        SELECT after->>'objectMirror' AS mirror, after->>'archiveId' AS name
        FROM audit_logs WHERE action = 'backup.create' AND after->>'archiveId' IN ($1, $2)
      `,
        [mirroredId, retainedId],
      );
      assert.deepEqual(
        Object.fromEntries(rows.map(({ name, mirror }) => [name, mirror])),
        {
          [mirroredId]: "succeeded",
          [retainedId]: "failed",
        },
      );
      assert.match(
        await sha256(path.join(archiveDirectory, retainedId)),
        /^[a-f0-9]{64}$/,
      );
      console.log(
        "Scheduled cloud mirror verified. A simulated upload failure retained the primary archive and returned exit code 3.",
      );
    }

    const restoreArgs = [
      ...shellArguments,
      "scripts/restore.ps1",
      "-ConfigPath",
      restoreConfig,
      "-TargetDatabase",
      target,
      "-ArchivePath",
      archive,
      "-IdentityPath",
      identityPath,
      "-PrivateScratchDirectory",
      root,
      "-ExpectedSha256",
    ];
    assert.equal(
      (await run(powershell, [...restoreArgs, "0".repeat(64)])).code,
      1,
      "Reject the wrong trusted digest",
    );
    const restore = await run(powershell, [...restoreArgs, digest]);
    assert.equal(
      restore.code,
      0,
      `Restore into a fresh restricted database. ${restore.stderr}`,
    );
    const verification = JSON.parse(restore.stdout);
    assert.equal(verification.payments, "1");
    assert.equal(verification.ledgerEntries, "2");
    assert.equal(verification.customerJournalTotal, "168.74");
    assert.equal(
      (await run(powershell, [...restoreArgs, digest])).code,
      1,
      "Refuse an existing populated target",
    );

    const targetUrl = new URL(adminUrl);
    targetUrl.username = migrationRole;
    targetUrl.password = migrationPassword;
    targetUrl.pathname = `/${target}`;
    await recoverOwner(targetUrl, target);
    targetClient = await connect(targetUrl, target);
    const {
      rows: [identity],
    } = await targetClient.query(
      `SELECT u.id, c.must_change_password,
       NOT EXISTS (SELECT 1 FROM sessions) AS no_sessions,
       EXISTS (SELECT 1 FROM audit_logs WHERE action = 'owner.restore-access') AS recovery_audited
       FROM users u JOIN user_credentials c ON c.user_id = u.id`,
    );
    assert.deepEqual(identity, {
      id: actorId,
      must_change_password: true,
      no_sessions: true,
      recovery_audited: true,
    });
    console.log(
      `Windows backup and restore verified. Restored one payment and reconciled PKR ${verification.customerJournalTotal}. Restore took ${verification.elapsedMs} ms.`,
    );
  } finally {
    await sourceClient?.end();
    await targetClient?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${source} WITH (FORCE)`);
    await admin.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${backupRole}, ${migrationRole}`);
    await admin.end();
    if (
      path.dirname(root) === path.resolve(tmpdir()) &&
      /^khancoal archive drill /.test(path.basename(root))
    ) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

try {
  const url = new URL(process.env.TEST_ADMIN_DATABASE_URL ?? "");
  const [postgresBin, ageBin] = process.argv.slice(2);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/postgres" ||
    !path.isAbsolute(postgresBin ?? "") ||
    !path.isAbsolute(ageBin ?? "")
  ) {
    throw new Error(
      "Provide a loopback TEST_ADMIN_DATABASE_URL and absolute PostgreSQL and age binary directories.",
    );
  }
  await drill(url, postgresBin, ageBin);
} catch (error) {
  // Only controlled assertions may include context. Database or process errors
  // may contain sensitive connection information.
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "The isolated Windows backup and restore drill failed.",
  );
  process.exitCode = 1;
}
