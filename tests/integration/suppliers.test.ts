import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { parseBusinessDate } from "../../src/domain/business-date";
import { PermissionDenied } from "../../src/domain/permissions";
import type { RoleCode } from "../../src/generated/prisma/client";
import { getSession, issueSession } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import {
  getSupplier,
  listDispatchSuppliers,
  listSuppliers,
  mutateSupplier,
  suppliersPageSize,
} from "../../src/server/parties/suppliers";
import { PeriodLockedError } from "../../src/server/repositories/periods";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Run supplier checks against an isolated migrated test database.",
  );
const database = makePrisma(databaseUrl);
const fixtureOwners: string[] = [];

afterAll(async () => {
  try {
    await database.user.updateMany({
      where: { id: { in: fixtureOwners } },
      data: { roleCode: "VIEWER" },
    });
  } finally {
    await database.$disconnect();
  }
});

async function actor(roleCode: RoleCode) {
  const key = randomUUID().replaceAll("-", "").slice(0, 16);
  const staff = await database.user.create({
    data: {
      username: `supplier_${key}`,
      email: `supplier-${key}@example.test`,
      displayName: "Supplier test fixture",
      roleCode,
      credential: {
        create: { passwordHash: "fixture", mustChangePassword: false },
      },
    },
    select: { id: true },
  });
  if (roleCode === "OWNER") fixtureOwners.push(staff.id);
  const token = await database.$transaction((tx) => issueSession(tx, staff.id));
  const principal = await getSession(token, database);
  if (!principal) throw new Error("Supplier fixture session was not issued.");
  return principal;
}

const context = () => ({ requestId: randomUUID() });
const create = (name: string) => ({
  operation: "create",
  key: randomUUID(),
  fields: {
    name,
    city: "Peshawar",
    contactPerson: "Synthetic contact",
    phone: "0300-1234567",
  },
});

describe("suppliers and mine directory", () => {
  it("creates a dated opening payable and default mine exactly once", async () => {
    const owner = await actor("OWNER");
    const name = `Opening Supplier ${randomUUID()}`;
    const command = {
      ...create(name),
      opening: { amount: "1250.20", date: "2026-10-06" },
      defaultMine: { code: "N-15", name: "North slope" },
    };
    const first = await mutateSupplier(database, owner, context(), command);
    await expect(
      mutateSupplier(database, owner, context(), command),
    ).resolves.toEqual(first);
    const supplier = await getSupplier(database, owner, first.supplierId);
    expect(supplier).toMatchObject({
      name,
      code: expect.stringMatching(/^SUP-\d{3,}$/),
      mines: [{ code: "N-15", name: "North slope", isDefault: true }],
    });
    const entries = await database.ledgerEntry.findMany({
      where: { supplierId: first.supplierId },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("SUPPLIER_OPENING");
    expect(entries[0]?.amount.toFixed(2)).toBe("1250.20");

    const adjustment = {
      operation: "openingCorrection",
      key: randomUUID(),
      supplierId: first.supplierId,
      opening: { amount: "-50.20", date: "2026-10-10" },
      reason: "Opening invoice reconciliation",
    };
    await mutateSupplier(database, owner, context(), adjustment);
    await mutateSupplier(database, owner, context(), adjustment);
    const list = await listSuppliers(database, owner, { search: name });
    expect(list.total).toBe(1);
    expect(Number(list.totals.due)).toBe(1200);
    expect(Number(list.rows[0]?.totals?.balance)).toBe(1200);
    expect(
      await database.ledgerEntry.count({
        where: { supplierId: first.supplierId },
      }),
    ).toBe(2);
  });

  it("rejects opening entries in locked months and blocks opening balances for accountants", async () => {
    const owner = await actor("OWNER");
    const accountant = await actor("ACCOUNTANT");
    const date = "2025-02-15";
    await database.periodLock.create({
      data: {
        month: parseBusinessDate("2025-02-01"),
        isMonthLocked: true,
        updatedById: owner.userId,
      },
    });
    const name = `Locked Supplier ${randomUUID()}`;
    const command = { ...create(name), opening: { amount: "20.00", date } };
    await expect(
      mutateSupplier(database, accountant, context(), command),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      mutateSupplier(database, owner, context(), command),
    ).rejects.toBeInstanceOf(PeriodLockedError);
    expect(await database.supplier.count({ where: { name } })).toBe(0);
    expect(
      await database.idempotencyKey.count({
        where: { actorId: owner.userId, key: command.key },
      }),
    ).toBe(0);
  });

  it("maintains a single default, rejects duplicate mine codes, and retains deactivated history", async () => {
    const accountant = await actor("ACCOUNTANT");
    const operator = await actor("OPERATOR");
    const name = `Mine Supplier ${randomUUID()}`;
    const { supplierId } = await mutateSupplier(
      database,
      accountant,
      context(),
      {
        ...create(name),
        defaultMine: { code: "EAST", name: "East seam" },
      },
    );
    await mutateSupplier(database, accountant, context(), {
      operation: "addMine",
      key: randomUUID(),
      supplierId,
      fields: { code: "WEST", name: "West seam", isDefault: true },
    });
    await expect(
      mutateSupplier(database, accountant, context(), {
        operation: "addMine",
        key: randomUUID(),
        supplierId,
        fields: { code: " east ", name: "Duplicate" },
      }),
    ).rejects.toMatchObject({ code: "duplicateMine" });
    const profile = await getSupplier(database, accountant, supplierId);
    if (!profile) throw new Error("Supplier fixture was not saved.");
    expect(
      profile.mines.filter((mine) => mine.isDefault).map((mine) => mine.code),
    ).toEqual(["WEST"]);

    const directory = await listDispatchSuppliers(database, operator, {
      search: "West seam",
    });
    const listed = directory.rows.find((row) => row.id === supplierId);
    expect(listed).toMatchObject({
      name,
      mines: [{ code: "WEST" }, { code: "EAST" }],
    });
    expect(listed).not.toHaveProperty("contactPerson");
    expect(listed).not.toHaveProperty("totals");
    await expect(
      listSuppliers(database, operator, { search: name }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    await mutateSupplier(database, accountant, context(), {
      operation: "edit",
      key: randomUUID(),
      supplierId,
      version: profile.updatedAt.toISOString(),
      fields: { ...create(name).fields, isActive: false },
    });
    expect(
      (await listDispatchSuppliers(database, operator, { search: name })).rows,
    ).toHaveLength(0);
    expect(
      (
        await listSuppliers(database, accountant, {
          search: name,
          status: "inactive",
        })
      ).rows,
    ).toHaveLength(1);
    expect(await database.mine.count({ where: { supplierId } })).toBe(2);
  });

  it("rechecks live permission for a repeat submission after role changes", async () => {
    const accountant = await actor("ACCOUNTANT");
    const command = create(`Repeated Supplier ${randomUUID()}`);
    await mutateSupplier(database, accountant, context(), command);
    await database.user.update({
      where: { id: accountant.userId },
      data: { roleCode: "VIEWER" },
    });
    await expect(
      mutateSupplier(database, accountant, context(), command),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("pages matching suppliers with no gaps between sorted pages", async () => {
    const accountant = await actor("ACCOUNTANT");
    const suffix = randomUUID().slice(0, 8);
    const search = `Pager ${suffix}`;
    await database.supplier.createMany({
      data: Array.from({ length: suppliersPageSize + 3 }, (_, index) => ({
        code: `PAGE-${suffix}-${index}`,
        name: `${search} ${String(index).padStart(2, "0")}`,
        nameKey: `${search.toLowerCase()} ${String(index).padStart(2, "0")}`,
        createdById: accountant.userId,
        updatedById: accountant.userId,
      })),
    });
    const first = await listSuppliers(database, accountant, { search });
    const second = await listSuppliers(database, accountant, {
      search,
      page: 2,
    });
    expect(first.page).toBe(1);
    expect(first.rows).toHaveLength(suppliersPageSize);
    expect(second.page).toBe(2);
    expect(second.rows).toHaveLength(3);
    expect(
      new Set([...first.rows, ...second.rows].map(({ id }) => id)).size,
    ).toBe(suppliersPageSize + 3);
  });
});
