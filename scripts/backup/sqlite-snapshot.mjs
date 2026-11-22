import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function snapshot(source, destination, recipient, age) {
  const scratch = await mkdtemp(join(tmpdir(), "khancoal-sqlite-"));
  const databaseFile = join(scratch, "snapshot.db");
  const name = `khancoal-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.db.age`;
  const encrypted = join(destination, name);
  const pending = `${encrypted}.partial`;

  try {
    const database = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(database, databaseFile);
    } finally {
      database.close();
    }

    const verification = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      if (
        verification.prepare("PRAGMA quick_check").get()?.quick_check !== "ok"
      ) {
        throw new Error("The SQLite snapshot failed its integrity check.");
      }
    } finally {
      verification.close();
    }

    await mkdir(destination, { recursive: true });
    await execute(age, ["-r", recipient, "-o", pending, databaseFile], {
      timeout: 180_000,
      windowsHide: true,
    });
    await rename(pending, encrypted);
    console.log(encrypted);
  } finally {
    // A WAL-mode source can leave empty sidecars on the temporary copy.
    const temporaryFiles = [
      pending,
      databaseFile,
      `${databaseFile}-journal`,
      `${databaseFile}-wal`,
      `${databaseFile}-shm`,
    ];
    for (const file of temporaryFiles) {
      try {
        await unlink(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await rmdir(scratch);
  }
}

const [source, destination, recipient, age = "age"] = process.argv.slice(2);
if (!source || !destination || !recipient?.startsWith("age1")) {
  console.error(
    "Usage: node scripts/backup/sqlite-snapshot.mjs <database> <backup folder> <age recipient> [age executable]",
  );
  process.exitCode = 2;
} else {
  try {
    await snapshot(source, destination, recipient, age);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "SQLite backup failed.",
    );
    process.exitCode = 1;
  }
}
