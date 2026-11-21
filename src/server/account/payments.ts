import { Decimal } from "decimal.js";
import { z } from "zod";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  PaymentMethod,
  type PaymentDirection,
} from "../../generated/prisma/enums";
import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../domain/business-date";
import { parseMoney } from "../../domain/money";
import { requirePermission, type Permission } from "../../domain/permissions";
import {
  requireLivePermission,
  type LivePrincipal,
} from "../auth/live-principal";
import { appendAuditEvent } from "../repositories/audit-log";
import {
  fingerprintCommand,
  IdempotencyConflictError,
  runIdempotentCommand,
} from "../repositories/idempotency";
import { reserveNumberBlock } from "../repositories/number-sequences";
import { getPartyRollups } from "../repositories/party-ledger-rollups";
import {
  lockOpenBusinessMonths,
  PeriodLockedError,
} from "../repositories/periods";

export type PaymentCommandErrorCode =
  | "invalid"
  | "required"
  | "missingOrInactive"
  | "wrongBankType"
  | "advance"
  | "closed"
  | "missing"
  | "transition"
  | "reversed";

export class PaymentCommandError extends Error {
  readonly outstanding?: string;
  readonly excess?: string;

  constructor(
    public readonly code: PaymentCommandErrorCode,
    public readonly field?: string,
    advance?: { outstanding: string; excess: string },
  ) {
    super(code);
    this.name = "PaymentCommandError";
    this.outstanding = advance?.outstanding;
    this.excess = advance?.excess;
  }
}

const key = z.uuid();
const businessDate = z.string().length(10);
const reason = z.string().trim().max(500);
const expectPayment = { key, paymentId: z.uuid(), businessDate };

const paymentInput = z.strictObject({
  key,
  direction: z.enum(["IN", "OUT"]),
  partyId: z.uuid(),
  method: z.enum(PaymentMethod),
  bankId: z
    .union([z.uuid(), z.literal("")])
    .nullish()
    .transform((value) => value || null),
  businessDate,
  amount: z.string().trim().min(1).max(64),
  referenceNo: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((value) => value || null),
  notes: z
    .string()
    .trim()
    .max(1500)
    .nullish()
    .transform((value) => value || null),
  confirmAdvance: z.boolean().default(false),
});

const chequeInput = z.strictObject({
  ...expectPayment,
  targetStatus: z.enum(["DEPOSITED", "CLEARED", "BOUNCED"]),
  reason: reason.nullish().transform((value) => value || null),
});

const voidInput = z.strictObject({ ...expectPayment, reason: reason.min(1) });

type PaymentRequest = { requestId: string; ipAddress?: string };
type PaymentInput = z.infer<typeof paymentInput>;

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new PaymentCommandError(
    issue?.code === "too_small" ? "required" : "invalid",
    String(issue?.path[0] ?? ""),
  );
}

function validBusinessDate(value: string, now: Date) {
  try {
    if (value <= todayBusinessDate(now)) return parseBusinessDate(value);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw new PaymentCommandError("invalid", "businessDate");
}

function paymentAmount(amount: string) {
  try {
    const parsed = parseMoney(amount);
    if (parsed.gt(0)) return parsed.toFixed(2);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  throw new PaymentCommandError("invalid", "amount");
}

function validMethod(input: PaymentInput) {
  if (input.method === "ADJUSTMENT") {
    if (input.bankId) throw new PaymentCommandError("invalid", "bankId");
    if (!input.notes) throw new PaymentCommandError("required", "notes");
  } else {
    if (!input.bankId) throw new PaymentCommandError("required", "bankId");
    if (input.method !== "CASH" && !input.referenceNo) {
      throw new PaymentCommandError("required", "referenceNo");
    }
  }
}

type PrincipalParty = { direction: PaymentDirection; partyId: string };

async function lockParty(
  tx: Prisma.TransactionClient,
  { direction, partyId }: PrincipalParty,
) {
  if (direction === "IN") {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${partyId}::uuid FOR UPDATE`;
    return tx.customer.findUnique({
      where: { id: partyId },
      select: { isActive: true },
    });
  }
  await tx.$queryRaw`SELECT id FROM suppliers WHERE id = ${partyId}::uuid FOR UPDATE`;
  return tx.supplier.findUnique({
    where: { id: partyId },
    select: { isActive: true },
  });
}

async function activeBank(tx: Prisma.TransactionClient, input: PaymentInput) {
  if (!input.bankId) return null;
  await tx.$queryRaw`SELECT id FROM banks WHERE id = ${input.bankId}::uuid FOR UPDATE`;
  const bank = await tx.bank.findUnique({
    where: { id: input.bankId },
    select: { id: true, category: true, isActive: true, name: true },
  });
  if (!bank?.isActive)
    throw new PaymentCommandError("missingOrInactive", "bankId");
  if (bank.category !== (input.method === "CASH" ? "CASH" : "BANK")) {
    throw new PaymentCommandError("wrongBankType", "bankId");
  }
  return bank;
}

async function checkAdvance(
  tx: Prisma.TransactionClient,
  input: PaymentInput,
  amount: string,
) {
  if (input.confirmAdvance) return;
  const party = input.direction === "IN" ? "customer" : "supplier";
  const [rollup] = await getPartyRollups(
    tx,
    party,
    [input.partyId],
    input.businessDate,
  );
  const outstanding = Decimal.max(rollup?.balance ?? "0", 0);
  const excess = new Decimal(amount).minus(outstanding);
  if (excess.gt(0)) {
    throw new PaymentCommandError("advance", "amount", {
      outstanding: outstanding.toFixed(2),
      excess: excess.toFixed(2),
    });
  }
}

async function runPaymentCommand(
  database: PrismaClient,
  actor: LivePrincipal,
  command: {
    key: string;
    operation: string;
    payload: Prisma.JsonValue;
    permission: Permission;
    now: Date;
  },
  execute: (tx: Prisma.TransactionClient) => Promise<string>,
) {
  try {
    const result = await runIdempotentCommand(
      database,
      {
        actorId: actor.userId,
        key: command.key,
        operation: command.operation,
        requestDigest: fingerprintCommand(command.payload),
        expiresAt: new Date(command.now.getTime() + 30 * 24 * 60 * 60_000),
      },
      async (tx) => ({ resourceIds: [await execute(tx)] }),
      (tx) => requireLivePermission(tx, actor, command.permission, command.now),
    );
    const [paymentId] = result.resourceIds;
    if (!paymentId)
      throw new Error("The payment command did not return a voucher.");
    return { paymentId };
  } catch (error) {
    if (error instanceof PeriodLockedError)
      throw new PaymentCommandError("closed", "businessDate");
    if (error instanceof IdempotencyConflictError)
      throw new PaymentCommandError("invalid", "key");
    throw error;
  }
}

export async function createPayment(
  database: PrismaClient,
  actor: LivePrincipal,
  request: PaymentRequest,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "account.manage");
  const input = validate(paymentInput, raw);
  const date = validBusinessDate(input.businessDate, now);
  const amount = paymentAmount(input.amount);
  validMethod(input);

  return runPaymentCommand(
    database,
    actor,
    {
      key: input.key,
      operation: "payment.create",
      payload: { ...input, amount },
      permission: "account.manage",
      now,
    },
    async (tx) => {
      await lockOpenBusinessMonths(tx, [date]);
      const party = await lockParty(tx, input);
      if (!party?.isActive)
        throw new PaymentCommandError("missingOrInactive", "partyId");
      const bank = await activeBank(tx, input);
      await checkAdvance(tx, input, amount);
      const company = await tx.companySettings.findUniqueOrThrow({
        where: { id: 1 },
        select: { voucherPrefix: true, documentProfileId: true },
      });
      const { firstOrdinal: ordinal } = await reserveNumberBlock(
        tx,
        "VOUCHER",
        0,
        1,
      );
      const voucherNo = `${company.voucherPrefix}-${String(ordinal).padStart(6, "0")}`;
      const incoming = input.direction === "IN";
      const parties = {
        customerId: incoming ? input.partyId : null,
        supplierId: incoming ? null : input.partyId,
      };
      const status = input.method === "CHEQUE" ? "RECEIVED" : "POSTED";
      const payment = await tx.payment.create({
        data: {
          voucherNo,
          ordinal,
          businessDate: date,
          ...parties,
          direction: input.direction,
          method: input.method,
          bankId: bank?.id ?? null,
          bankName: bank?.name ?? null,
          referenceNo: input.referenceNo,
          amount,
          notes: input.notes,
          documentProfileId: company.documentProfileId,
          createdById: actor.userId,
          status,
        },
        select: { id: true },
      });
      await tx.ledgerEntry.create({
        data: {
          kind: incoming ? "CUSTOMER_RECEIPT" : "SUPPLIER_PAYMENT",
          businessDate: date,
          ...parties,
          paymentId: payment.id,
          amount: `-${amount}`,
          actorId: actor.userId,
        },
        select: { id: true },
      });
      await appendAuditEvent(tx, {
        ...request,
        actor: { type: "USER", id: actor.userId },
        area: "account",
        action: "payment.create",
        targetType: "payment",
        targetId: payment.id,
        outcome: "SUCCESS",
        after: {
          voucherNo,
          businessDate: input.businessDate,
          amount,
          direction: input.direction,
          method: input.method,
          status,
          partyId: input.partyId,
          bankId: bank?.id ?? null,
          advanceConfirmed: input.confirmAdvance,
        },
      });
      return payment.id;
    },
  );
}

async function lockVoucher(tx: Prisma.TransactionClient, paymentId: string) {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
  const voucher = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      direction: true,
      method: true,
      businessDate: true,
      customerId: true,
      supplierId: true,
      status: true,
      chequeEvents: {
        orderBy: [{ businessDate: "desc" }, { id: "desc" }],
        take: 1,
        select: { businessDate: true },
      },
    },
  });
  if (!voucher) throw new PaymentCommandError("missing", "paymentId");
  if (voucher.status === "BOUNCED" || voucher.status === "VOIDED") {
    throw new PaymentCommandError("reversed", "paymentId");
  }
  return voucher;
}

type LockedVoucher = Awaited<ReturnType<typeof lockVoucher>>;

function checkEffectiveDate(voucher: LockedVoucher, date: Date) {
  const lastEventDate =
    voucher.chequeEvents[0]?.businessDate ?? voucher.businessDate;
  if (date < lastEventDate)
    throw new PaymentCommandError("invalid", "businessDate");
}

async function appendPaymentReversal(
  tx: Prisma.TransactionClient,
  voucher: LockedVoucher,
  parameters: { date: Date; reason: string; actorId: string },
) {
  const partyId =
    voucher.direction === "IN" ? voucher.customerId : voucher.supplierId;
  if (
    !partyId ||
    !(await lockParty(tx, { direction: voucher.direction, partyId }))
  ) {
    throw new Error("An issued voucher is missing its party.");
  }
  const original = await tx.ledgerEntry.findFirst({
    where: { paymentId: voucher.id, reversesId: null },
    select: {
      id: true,
      customerId: true,
      supplierId: true,
      kind: true,
      amount: true,
      reversal: { select: { id: true } },
    },
  });
  if (!original)
    throw new Error("An issued voucher is missing its ledger posting.");
  if (original.reversal) throw new PaymentCommandError("reversed", "paymentId");
  const reversal = await tx.ledgerEntry.create({
    data: {
      kind: original.kind,
      businessDate: parameters.date,
      customerId: original.customerId,
      supplierId: original.supplierId,
      paymentId: voucher.id,
      reversesId: original.id,
      amount: original.amount.negated().toFixed(2),
      reason: parameters.reason,
      actorId: parameters.actorId,
    },
    select: { id: true },
  });
  return String(reversal.id);
}

export async function transitionCheque(
  database: PrismaClient,
  actor: LivePrincipal,
  request: PaymentRequest,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "account.manage");
  const input = validate(chequeInput, raw);
  const date = validBusinessDate(input.businessDate, now);
  const bounceReason = input.targetStatus === "BOUNCED" ? input.reason : null;
  if (input.targetStatus === "BOUNCED" && !bounceReason) {
    throw new PaymentCommandError("required", "reason");
  }
  return runPaymentCommand(
    database,
    actor,
    {
      key: input.key,
      operation: "payment.cheque-transition",
      payload: input,
      permission: "account.manage",
      now,
    },
    async (tx) => {
      await lockOpenBusinessMonths(tx, [date]);
      const voucher = await lockVoucher(tx, input.paymentId);
      checkEffectiveDate(voucher, date);
      const requiredStatus =
        input.targetStatus === "DEPOSITED" ? "RECEIVED" : "DEPOSITED";
      if (voucher.method !== "CHEQUE" || voucher.status !== requiredStatus) {
        throw new PaymentCommandError("transition", "targetStatus");
      }
      const reversalId = bounceReason
        ? await appendPaymentReversal(tx, voucher, {
            date,
            reason: bounceReason,
            actorId: actor.userId,
          })
        : null;
      await tx.chequeEvent.create({
        data: {
          paymentId: voucher.id,
          previous: voucher.status,
          resulting: input.targetStatus,
          businessDate: date,
          actorId: actor.userId,
          reason: input.reason,
        },
        select: { id: true },
      });
      await tx.payment.update({
        where: { id: voucher.id },
        data: { status: input.targetStatus },
        select: { id: true },
      });
      await appendAuditEvent(tx, {
        ...request,
        actor: { type: "USER", id: actor.userId },
        area: "account",
        action: "payment.cheque-transition",
        targetType: "payment",
        targetId: voucher.id,
        outcome: "SUCCESS",
        before: { status: voucher.status },
        after: {
          status: input.targetStatus,
          businessDate: input.businessDate,
          reversalId,
        },
      });
      return voucher.id;
    },
  );
}

export async function voidPayment(
  database: PrismaClient,
  actor: LivePrincipal,
  request: PaymentRequest,
  raw: unknown,
  now = new Date(),
) {
  requirePermission(actor, "account.void");
  const input = validate(voidInput, raw);
  const date = validBusinessDate(input.businessDate, now);
  return runPaymentCommand(
    database,
    actor,
    {
      key: input.key,
      operation: "payment.void",
      payload: input,
      permission: "account.void",
      now,
    },
    async (tx) => {
      await lockOpenBusinessMonths(tx, [date]);
      const voucher = await lockVoucher(tx, input.paymentId);
      checkEffectiveDate(voucher, date);
      const reversalId = await appendPaymentReversal(tx, voucher, {
        date,
        reason: input.reason,
        actorId: actor.userId,
      });
      await tx.payment.update({
        where: { id: voucher.id },
        data: {
          status: "VOIDED",
          voidedById: actor.userId,
          voidedAt: now,
          voidReason: input.reason,
        },
        select: { id: true },
      });
      await appendAuditEvent(tx, {
        ...request,
        actor: { type: "USER", id: actor.userId },
        area: "account",
        action: "payment.void",
        targetType: "payment",
        targetId: voucher.id,
        outcome: "SUCCESS",
        before: { status: voucher.status },
        after: {
          status: "VOIDED",
          businessDate: input.businessDate,
          reversalId,
        },
      });
      return voucher.id;
    },
  );
}
