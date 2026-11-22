import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { verify } from "@node-rs/argon2";
import { expect, it } from "vitest";
import { makePrisma } from "../../src/server/db/connect";

it("imports one reconciled SQLite file and protects both databases", async () => {
  const sourceUrl = process.env.INTEGRATION_DATABASE_URL!;
  const source = makePrisma(sourceUrl);
  const directory = await mkdtemp(join(tmpdir(), "khancoal-import-test-"));
  const path = join(directory, "khancoal.db");
  const run = () =>
    spawnSync(
      process.execPath,
      ["scripts/import-postgres-to-sqlite.mjs", path],
      {
        env: { ...process.env, MIGRATION_SOURCE_DATABASE_URL: sourceUrl },
        encoding: "utf8",
        timeout: 12_000,
      },
    );

  try {
    const username = `migration-${randomUUID()}`;
    const actor = await source.user.create({
      data: {
        username,
        displayName: "SQLite import test",
        email: `${username}@example.test`,
        roleCode: "ACCOUNTANT",
        credential: {
          create: { passwordHash: randomBytes(32).toString("hex") },
        },
      },
    });
    const customer = await source.customer.create({
      data: {
        code: `IMPORT-${randomBytes(6).toString("hex")}`,
        name: "Import test customer",
        nameKey: "import test customer",
        creditLimit: "999999999999.99",
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    const posting = await source.ledgerEntry.create({
      data: {
        actorId: actor.id,
        customerId: customer.id,
        kind: "CUSTOMER_OPENING",
        businessDate: new Date("2026-01-01T00:00:00Z"),
        amount: "0.29",
      },
    });

    const imported = run();
    expect(imported.status, imported.stderr).toBe(0);
    const target = new DatabaseSync(path);
    try {
      expect(target.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
      expect(target.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        target.prepare("SELECT count(*) AS count FROM user_credentials").get()
          ?.count,
      ).toBe(0);
      expect(
        target.prepare("SELECT id FROM users WHERE username = ?").get(username)
          ?.id,
      ).toBe(actor.id);
      const credit = target.prepare(
        "SELECT credit_limit FROM customers WHERE id = ?",
      );
      credit.setReadBigInts(true);
      expect(credit.get(customer.id)?.credit_limit).toBe(99999999999999n);
      const ledger = target.prepare(
        "SELECT amount, business_date FROM ledger_entries WHERE id = ?",
      );
      ledger.setReadBigInts(true);
      expect(ledger.get(posting.id)).toEqual({
        amount: 29n,
        business_date: "2026-01-01",
      });
      expect(() =>
        target
          .prepare("UPDATE ledger_entries SET amount = 7 WHERE id = ?")
          .run(posting.id),
      ).toThrow(/append-only/);
    } finally {
      target.close();
    }
    const archive = await readFile(path);
    const secondImport = run();
    expect(secondImport.status).toBe(1);
    expect(secondImport.stderr).toContain("destination already exists");
    expect(await readFile(path)).toEqual(archive);
    expect(
      (
        await source.ledgerEntry.findUniqueOrThrow({
          where: { id: posting.id },
        })
      ).amount.toFixed(2),
    ).toBe("0.29");

    const password = randomBytes(24).toString("base64url");
    const recover = () =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/recover-sqlite-owner.ts", path, username],
        { input: password, encoding: "utf8", timeout: 10_000 },
      );
    const rejected = recover();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("active Owner");
    const recoveryFixture = new DatabaseSync(path);
    try {
      recoveryFixture
        .prepare("UPDATE users SET role_code = 'OWNER' WHERE id = ?")
        .run(actor.id);
    } finally {
      recoveryFixture.close();
    }
    const recovery = recover();
    expect(recovery.status, recovery.stderr).toBe(0);
    const recovered = new DatabaseSync(path, { readOnly: true });
    try {
      const credential = recovered
        .prepare(
          "SELECT password_hash, must_change_password FROM user_credentials WHERE user_id = ?",
        )
        .get(actor.id);
      expect(credential?.must_change_password).toBe(1);
      expect(typeof credential?.password_hash).toBe("string");
      await expect(
        verify(String(credential?.password_hash), password),
      ).resolves.toBe(true);
      expect(
        recovered
          .prepare(
            "SELECT count(*) AS count FROM audit_logs WHERE action = 'owner.restore-access' AND target_id = ?",
          )
          .get(actor.id)?.count,
      ).toBe(1);
    } finally {
      recovered.close();
    }
    const repeatedRecovery = recover();
    expect(repeatedRecovery.status).toBe(1);
    expect(repeatedRecovery.stderr).toContain("fresh copy without credentials");
  } finally {
    await source.$disconnect();
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
