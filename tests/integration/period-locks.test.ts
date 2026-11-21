import { afterAll, describe, expect, it } from "vitest";
import { parseBusinessDate } from "../../src/domain/business-date";
import { makePrisma } from "../../src/server/db/connect";
import {
  lockOpenBusinessMonths,
  PeriodLockedError,
} from "../../src/server/repositories/periods";

const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);

afterAll(async () => database.$disconnect());

describe("shared accounting period gates", () => {
  it("materializes each required gate once in concurrent transactions", async () => {
    const may = parseBusinessDate("2089-05-01");
    const june = parseBusinessDate("2089-06-02");
    await Promise.all([
      database.$transaction((tx) =>
        lockOpenBusinessMonths(tx, [
          june,
          may,
          parseBusinessDate("2089-05-30"),
        ]),
      ),
      database.$transaction((tx) => lockOpenBusinessMonths(tx, [may, june])),
    ]);
    const rows = await database.periodLock.findMany({
      where: { month: { gte: may, lte: june } },
      orderBy: { month: "asc" },
    });
    expect(rows.map((row) => row.month.toISOString().slice(0, 10))).toEqual([
      "2089-05-01",
      "2089-06-01",
    ]);
  });

  it("rejects writes for a period covered by a year lock", async () => {
    const actor = await database.user.create({
      data: {
        username: "period-gate-tester",
        email: "period-gate-tester@example.test",
        displayName: "Period gate tester",
        roleCode: "ACCOUNTANT",
      },
      select: { id: true },
    });
    await database.periodLock.create({
      data: {
        month: parseBusinessDate("2089-07-01"),
        isYearLocked: true,
        updatedById: actor.id,
      },
    });
    await expect(
      database.$transaction((tx) =>
        lockOpenBusinessMonths(tx, [parseBusinessDate("2089-07-31")]),
      ),
    ).rejects.toBeInstanceOf(PeriodLockedError);
  });
});
