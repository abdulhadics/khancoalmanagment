import { z } from "zod";

import type {
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
} from "@/generated/prisma/client";
import type { SessionActor } from "@/server/auth/session";
import {
  documentProfileFields,
  readDocumentForPrint,
  type DocumentProfile,
  type PrintContext,
} from "@/server/documents/print-data";
import { appendAuditEvent } from "@/server/repositories/audit-log";

export type VoucherDocument = {
  profile: DocumentProfile;
  generatedAt: Date;
  preparedBy: string;
  voucherNo: string;
  date: Date;
  statusDate: Date;
  status: PaymentStatus;
  direction: PaymentDirection;
  method: PaymentMethod;
  party: { code: string; name: string };
  bankName: string | null;
  referenceNo: string | null;
  amount: string;
  notes: string | null;
};

const paymentId = z.uuid();

export async function readPaymentVoucher(
  database: PrismaClient,
  actor: SessionActor,
  id: string,
  context: PrintContext,
  now = new Date(),
): Promise<VoucherDocument | null> {
  if (!paymentId.safeParse(id).success) return null;

  return readDocumentForPrint(
    database,
    actor,
    "account.view",
    context,
    now,
    async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id },
        select: {
          voucherNo: true,
          businessDate: true,
          status: true,
          direction: true,
          method: true,
          customer: { select: { name: true, code: true } },
          supplier: { select: { name: true, code: true } },
          bankName: true,
          referenceNo: true,
          amount: true,
          notes: true,
          documentProfile: { select: documentProfileFields },
          createdBy: { select: { displayName: true } },
          chequeEvents: {
            select: { businessDate: true },
            orderBy: { id: "desc" },
            take: 1,
          },
          ledgerEntries: {
            where: { reversesId: { not: null } },
            select: { businessDate: true },
            orderBy: { id: "desc" },
            take: 1,
          },
        },
      });
      if (!payment) return null;
      const party =
        payment.direction === "IN" ? payment.customer : payment.supplier;
      if (!party) throw new Error("Voucher party is missing.");
      const statusChange =
        payment.status === "VOIDED"
          ? payment.ledgerEntries[0]
          : payment.chequeEvents[0];

      await appendAuditEvent(tx, {
        ...context,
        actor: { type: "USER", id: actor.userId },
        area: "account",
        action: "payment.voucher-print",
        targetType: "payment",
        targetId: id,
        outcome: "SUCCESS",
        after: { status: payment.status },
      });

      return {
        profile: payment.documentProfile,
        generatedAt: now,
        preparedBy: payment.createdBy.displayName,
        voucherNo: payment.voucherNo,
        date: payment.businessDate,
        statusDate: statusChange?.businessDate ?? payment.businessDate,
        status: payment.status,
        direction: payment.direction,
        method: payment.method,
        party,
        bankName: payment.bankName,
        referenceNo: payment.referenceNo,
        amount: payment.amount.toFixed(2),
        notes: payment.notes,
      };
    },
  );
}
