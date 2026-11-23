import { requirePermission } from "@/domain/permissions";
import { parseBusinessDate } from "@/domain/business-date";
import {
  Prisma,
  type ExpenseCategory,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { LivePrincipal } from "../auth/live-principal";

export const expensesPageSize = 20;

export type ExpenseFilterOptions = {
  from?: string;
  to?: string;
  category?: string;
  page?: number;
};

export type ExpenseRow = {
  id: string;
  businessDate: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdByName: string;
};

export async function readExpensesList(
  database: PrismaClient,
  actor: LivePrincipal,
  filters: ExpenseFilterOptions = {},
) {
  requirePermission(actor, "expenses.view");

  const whereConditions: Prisma.ExpenseWhereInput = {};

  if (filters.category && filters.category !== "all") {
    whereConditions.category = filters.category as ExpenseCategory;
  }

  if (filters.from || filters.to) {
    whereConditions.businessDate = {};
    if (filters.from) {
      whereConditions.businessDate.gte = parseBusinessDate(filters.from);
    }
    if (filters.to) {
      whereConditions.businessDate.lte = parseBusinessDate(filters.to);
    }
  }

  const page = Math.max(1, filters.page ?? 1);

  const [totalCount, activeAggregation, rawExpenses] = await Promise.all([
    database.expense.count({ where: whereConditions }),
    database.expense.aggregate({
      where: { ...whereConditions, voidedAt: null },
      _sum: { amount: true },
    }),
    database.expense.findMany({
      where: whereConditions,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * expensesPageSize,
      take: expensesPageSize,
      include: {
        createdBy: { select: { displayName: true } },
      },
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(totalCount / expensesPageSize));

  const rows: ExpenseRow[] = rawExpenses.map((exp) => ({
    id: exp.id,
    businessDate: exp.businessDate.toISOString().slice(0, 10),
    category: exp.category,
    description: exp.description,
    amount: exp.amount.toFixed(2),
    notes: exp.notes,
    voidedAt: exp.voidedAt ? exp.voidedAt.toISOString() : null,
    voidReason: exp.voidReason,
    createdByName: exp.createdBy.displayName,
  }));

  return {
    rows,
    totalCount,
    totalActiveAmount: activeAggregation._sum.amount?.toFixed(2) ?? "0.00",
    page,
    lastPage,
  };
}

export async function readTotalExpenses(
  db: PrismaClient | Prisma.TransactionClient,
  bounds: { from?: string; to: string },
) {
  const businessDate: Prisma.DateTimeFilter = {
    lte: parseBusinessDate(bounds.to),
  };

  if (bounds.from) {
    businessDate.gte = parseBusinessDate(bounds.from);
  }

  const where: Prisma.ExpenseWhereInput = {
    voidedAt: null,
    businessDate,
  };

  const result = await db.expense.aggregate({
    where,
    _sum: { amount: true },
  });

  return result._sum.amount?.toFixed(2) ?? "0.00";
}
