import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { hashPassword } from "../src/server/auth/password";
import {
  OwnerRecoveryError,
  readRecoveryPassword,
} from "./owner-recovery-input";

async function run() {
  const [path, username, ...extra] = process.argv.slice(2);
  if (
    !path?.toLowerCase().endsWith(".db") ||
    !username?.trim() ||
    extra.length
  ) {
    throw new OwnerRecoveryError(
      "Provide the imported SQLite file and active Owner username.",
    );
  }
  if (!(await lstat(path)).isFile()) {
    throw new OwnerRecoveryError("Select an existing local database file.");
  }

  const passwordHash = await hashPassword(await readRecoveryPassword());
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
  });
  try {
    if (
      database.prepare("PRAGMA application_id").get()?.application_id !==
        0x4b48434c ||
      database.prepare("PRAGMA user_version").get()?.user_version !== 1
    ) {
      throw new OwnerRecoveryError(
        "This file is not a supported KhanCoal SQLite database.",
      );
    }
    database.exec("BEGIN IMMEDIATE");
    if (
      database.prepare("SELECT 1 FROM user_credentials LIMIT 1").get() ||
      database.prepare("SELECT 1 FROM sessions LIMIT 1").get()
    ) {
      throw new OwnerRecoveryError(
        "Owner recovery requires a fresh copy without credentials or sessions.",
      );
    }
    const owner = database
      .prepare(
        "SELECT id FROM users WHERE username = ? AND role_code = 'OWNER' AND is_active = 1",
      )
      .get(username.trim().toLowerCase());
    if (typeof owner?.id !== "string") {
      throw new OwnerRecoveryError(
        "Enter the username of an active Owner in this copy.",
      );
    }
    database
      .prepare(
        "INSERT INTO user_credentials (user_id, password_hash, must_change_password, recovery_code_digests) VALUES (?, ?, 1, '[]')",
      )
      .run(owner.id, passwordHash);
    database
      .prepare(
        `
      INSERT INTO audit_logs (id, actor_type, area, action, target_type, target_id, occurred_at, request_id, outcome)
      SELECT coalesce(max(id), 0) + 1, 'SYSTEM', 'identity', 'owner.restore-access', 'user', ?, ?, ?, 'SUCCESS'
      FROM audit_logs
    `,
      )
      .run(owner.id, new Date().toISOString(), randomUUID());
    database.exec("COMMIT");
  } finally {
    database.close();
  }
  console.log("Temporary Owner access prepared in the SQLite copy.");
}

try {
  await run();
} catch (error) {
  console.error(
    error instanceof OwnerRecoveryError
      ? error.message
      : "Owner recovery failed. Check file access and the imported database.",
  );
  process.exitCode = 1;
}
