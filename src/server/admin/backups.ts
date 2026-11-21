import { execFile } from "node:child_process";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { z } from "zod";
import { requirePermission, type PermissionActor } from "@/domain/permissions";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";

const permission = "admin.backups";
const maximumBackupAgeMs = 48 * 60 * 60_000;
const archiveName = /^khancoal-\d{8}T\d{9}Z-[a-f0-9]{32}\.dump\.age$/;
const execute = promisify(execFile);
const windowsChildEnvironment = new Set([
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "PATH",
  "SYSTEMDRIVE",
  "USERPROFILE",
]);
const downloadConfiguration = z.object({
  archiveDirectory: z.string().refine((value) => path.isAbsolute(value)),
  timeoutSeconds: z.number().int().min(15).max(3600).default(1800),
});
const newestSuccessfulBackup = {
  where: { state: "SUCCEEDED" as const, completedAt: { not: null } },
  orderBy: [{ completedAt: "desc" as const }, { id: "desc" as const }],
  select: { completedAt: true },
};

export class BackupDownloadError extends Error {
  constructor(readonly code: "unconfigured" | "busy" | "failed") {
    super(code);
    this.name = "BackupDownloadError";
  }
}

async function readDownloadConfiguration() {
  const configPath = process.env.KHANCOAL_BACKUP_CONFIG;
  if (
    process.platform !== "win32" ||
    !configPath ||
    !path.isAbsolute(configPath)
  )
    return null;
  try {
    const contents = await readFile(configPath, "utf8");
    const configured = downloadConfiguration.parse(JSON.parse(contents));
    const directory = await realpath(configured.archiveDirectory);
    if (!(await lstat(directory)).isDirectory()) return null;
    return { ...configured, configPath, directory };
  } catch {
    return null;
  }
}

export async function readLatestBackup(
  database: PrismaClient,
  actor: PermissionActor,
  now = new Date(),
) {
  requirePermission(actor, permission);
  const record = await database.backup.findFirst(newestSuccessfulBackup);
  const completedAt = record?.completedAt ?? null;
  return {
    completedAt,
    stale:
      !completedAt ||
      now.getTime() - completedAt.getTime() > maximumBackupAgeMs,
  };
}

export async function readBackupOverview(
  database: PrismaClient,
  actor: PermissionActor,
) {
  requirePermission(actor, permission);
  const [latest, configuration, records] = await Promise.all([
    readLatestBackup(database, actor),
    readDownloadConfiguration(),
    database.backup.findMany({
      take: 20,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        source: true,
        state: true,
        startedAt: true,
        completedAt: true,
        archiveId: true,
        archiveHash: true,
      },
    }),
  ]);
  return { latest, configured: configuration !== null, records };
}

export async function createBackupDownload(
  database: PrismaClient,
  actor: LivePrincipal,
  context: { requestId: string; ipAddress?: string },
) {
  await database.$transaction((tx) =>
    requireLivePermission(tx, actor, permission),
  );
  const configured = await readDownloadConfiguration();
  if (!configured) throw new BackupDownloadError("unconfigured");
  const args = [
    path.join(process.cwd(), "scripts", "backup", "create.mjs"),
    "--config",
    configured.configPath,
    "--actor-id",
    actor.userId,
    "--request-id",
    context.requestId,
  ];
  if (context.ipAddress) args.push("--ip-address", context.ipAddress);
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        windowsChildEnvironment.has(key.toUpperCase()),
      ),
    ),
  };
  let name: string;
  try {
    const { stdout } = await execute(process.execPath, args, {
      env,
      windowsHide: true,
      timeout: (configured.timeoutSeconds + 90) * 1000,
      maxBuffer: 16_384,
    });
    name = stdout.trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new BackupDownloadError(Number(code) === 2 ? "busy" : "failed");
  }
  if (!archiveName.test(name)) throw new BackupDownloadError("failed");

  const archive = await database.$transaction(async (tx) => {
    await requireLivePermission(tx, actor, permission);
    return tx.backup.findFirst({
      where: {
        archiveId: name,
        actorId: actor.userId,
        source: "MANUAL",
        state: "SUCCEEDED",
      },
      select: { byteCount: true },
    });
  });
  if (!archive?.byteCount) throw new BackupDownloadError("failed");
  const filename = path.join(configured.directory, name);
  try {
    if ((await realpath(filename)) !== filename)
      throw new BackupDownloadError("failed");
    const file = await open(filename, "r");
    try {
      const metadata = await file.stat({ bigint: true });
      if (!metadata.isFile() || metadata.size !== archive.byteCount)
        throw new BackupDownloadError("failed");
      const stream = Readable.toWeb(
        file.createReadStream(),
      ) as ReadableStream<Uint8Array>;
      return { name, size: metadata.size, stream };
    } catch (error) {
      await file.close();
      throw error;
    }
  } catch {
    throw new BackupDownloadError("failed");
  }
}
