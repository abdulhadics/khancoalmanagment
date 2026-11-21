import { requirePermission, type PermissionActor } from "@/domain/permissions";
import type { Prisma } from "@/generated/prisma/client";

export type IntegrityFinding = {
  kind: "order" | "payment" | "sequence";
  subject: string;
};

export async function readAccountingIntegrity(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  actor: PermissionActor,
) {
  requirePermission(actor, "admin.integrity");

  // Compare operational snapshots to independent journal facts. Metadata-only
  // order revisions may retain a posting pair from an earlier revision.
  const results = await database.$queryRaw<
    (IntegrityFinding & { total: bigint })[]
  >`
    WITH original_order_entries AS (
      SELECT revision.order_id, revision.id AS posting_revision_id,
             revision.weight,
             revision.purchase_rate, revision.sell_rate, entry.kind,
             entry.amount, entry.business_date, revision.customer_id,
             revision.supplier_id, revision.mine_id
      FROM ledger_entries AS entry
      JOIN order_revisions AS revision ON revision.id = entry.order_revision_id
      WHERE entry.reverses_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE reverses_id = entry.id)
    ),
    order_findings AS (
      SELECT 'order'::text AS kind, orders.order_no::text AS subject
      FROM orders
      LEFT JOIN order_revisions AS expected
        ON expected.order_id = orders.id AND expected.revision_no = orders.current_revision_no
      LEFT JOIN original_order_entries AS actual ON actual.order_id = orders.id
      GROUP BY orders.id, expected.id
      HAVING expected.id IS NULL
        OR (orders.status <> 'POSTED' AND count(actual.posting_revision_id) <> 0)
        OR (orders.status = 'POSTED' AND (
          count(*) FILTER (WHERE actual.kind = 'ORDER_SALE') <> 1
          OR count(*) FILTER (WHERE actual.kind = 'ORDER_PURCHASE') <> 1
          OR count(DISTINCT actual.posting_revision_id) <> 1
          OR NOT COALESCE(bool_and(
            actual.business_date = expected.business_date
            AND actual.customer_id = expected.customer_id
            AND actual.supplier_id = expected.supplier_id
            AND actual.mine_id = expected.mine_id
            AND actual.weight = expected.weight
            AND actual.purchase_rate IS NOT DISTINCT FROM expected.purchase_rate
            AND actual.sell_rate IS NOT DISTINCT FROM expected.sell_rate
            AND actual.amount IS NOT DISTINCT FROM CASE
              WHEN actual.kind = 'ORDER_SALE' THEN expected.sell_amount ELSE expected.buy_amount END
          ), false)
        ))
    ),
    payment_findings AS (
      SELECT 'payment'::text AS kind, payment.voucher_no::text AS subject
      FROM payments AS payment
      LEFT JOIN ledger_entries AS original
        ON original.payment_id = payment.id AND original.reverses_id IS NULL
      LEFT JOIN ledger_entries AS reversal ON reversal.reverses_id = original.id
      GROUP BY payment.id
      HAVING count(original.id) <> 1
        OR NOT COALESCE(bool_and(
          original.amount = -payment.amount
          AND original.business_date = payment.business_date
          AND original.customer_id IS NOT DISTINCT FROM payment.customer_id
          AND original.supplier_id IS NOT DISTINCT FROM payment.supplier_id
          AND original.kind = CASE
            WHEN payment.direction = 'IN' THEN 'CUSTOMER_RECEIPT'::ledger_entry_kind
            ELSE 'SUPPLIER_PAYMENT'::ledger_entry_kind END
        ), false)
        OR (payment.status IN ('BOUNCED', 'VOIDED')) <> (count(reversal.id) = 1)
    ),
    issued AS (
      SELECT 'ORDER'::number_sequence_kind AS kind, number_year::integer AS scope,
             count(*) AS issued_count, min(ordinal) AS first_ordinal, max(ordinal) AS last_ordinal
      FROM orders GROUP BY number_year
      UNION ALL
      SELECT 'VOUCHER'::number_sequence_kind, 0, count(*), min(ordinal), max(ordinal)
      FROM payments HAVING count(*) > 0
    ),
    counters AS (SELECT * FROM number_sequences WHERE kind IN ('ORDER', 'VOUCHER')),
    sequence_findings AS (
      SELECT 'sequence'::text AS kind,
        COALESCE(issued.kind, counters.kind)::text || ' ' || COALESCE(issued.scope, counters.scope)::text AS subject
      FROM issued FULL JOIN counters USING (kind, scope)
      WHERE COALESCE(counters.next_ordinal, 0) <> COALESCE(issued.last_ordinal, 0) + 1
        OR COALESCE(issued.first_ordinal, 1) <> 1
        OR COALESCE(issued.issued_count, 0) <> COALESCE(issued.last_ordinal, 0)
    ),
    findings AS (
      SELECT * FROM order_findings
      UNION ALL SELECT * FROM payment_findings
      UNION ALL SELECT * FROM sequence_findings
    )
    SELECT kind, subject, count(*) OVER () AS total
    FROM findings
    ORDER BY kind, subject
    LIMIT 200
  `;

  return {
    checkedAt: new Date(),
    total: Number(results[0]?.total ?? 0n),
    findings: results.map(({ kind, subject }) => ({ kind, subject })),
  };
}
