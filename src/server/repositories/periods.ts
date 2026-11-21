import type { Prisma } from "@/generated/prisma/client";

export class PeriodLockedError extends Error {
  constructor(readonly month: string) {
    super("The accounting period is locked.");
    this.name = "PeriodLockedError";
  }
}

export async function lockOpenBusinessMonths(
  tx: Prisma.TransactionClient,
  dates: readonly Date[],
): Promise<void> {
  const monthKeys = [
    ...new Set(dates.map((date) => `${date.toISOString().slice(0, 7)}-01`)),
  ].sort();

  // Lock and unlock commands must acquire these same rows in month order.
  for (const month of monthKeys) {
    await tx.$executeRaw`
      INSERT INTO period_locks (month)
      VALUES (${month}::date)
      ON CONFLICT (month) DO NOTHING
    `;
    const [gate] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT is_month_locked OR is_year_locked AS locked
      FROM period_locks
      WHERE month = ${month}::date
      FOR UPDATE
    `;
    if (!gate) throw new Error("Accounting period gate could not be read.");
    if (gate.locked) throw new PeriodLockedError(month);
  }
}
