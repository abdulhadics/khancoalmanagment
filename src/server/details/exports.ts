import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatDecimal } from "@/domain/number-display";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { messages } from "@/i18n";
import { detailsExport as copy } from "@/i18n/messages/details-export-en";
import { ledgerMessages } from "@/i18n/messages/ledger-en";
import { documentPrint } from "@/i18n/messages/print-en";
import { settings } from "@/i18n/messages/settings-en";
import type { SessionActor } from "@/server/auth/session";
import { csvDecimal, renderCsv } from "@/server/documents/csv";
import {
  exportFilteredDocument,
  exportSubtitle,
  FilteredExportError,
  type ExportDocumentMetadata,
  type FilteredExportDocument,
} from "@/server/documents/filtered-export";
import {
  renderTablePdf,
  type PdfTableColumn,
} from "@/server/documents/pdf-table";
import type { PrintContext } from "@/server/documents/print-data";
import { printTextResponse } from "@/server/documents/print-response";
import { ReportPeriodError } from "@/server/reporting/period";
import {
  readSalesDetailsExport,
  SalesFiltersError,
} from "@/server/reporting/sales-details";
import {
  parsePartyLedgerFilters,
  readPartyLedger,
  type LedgerParty,
  type PartyLedgerRow,
} from "./party-ledger";

type DetailKind = "sales" | LedgerParty;
type SalesData = Awaited<ReturnType<typeof readSalesDetailsExport>>;
type LedgerData = NonNullable<Awaited<ReturnType<typeof readPartyLedger>>>;

const salesHeader = [
  copy.orderNo,
  copy.date,
  copy.customer,
  copy.supplier,
  copy.mine,
  copy.vehicle,
  copy.bilty,
  copy.weight,
  copy.purchaseRate,
  copy.buyAmount,
  copy.sellRate,
  copy.sellAmount,
  copy.profit,
];

function salesCsv(data: SalesData) {
  const { totals } = data;
  const rows = data.rows.map((row) => [
    row.orderNo,
    row.businessDate,
    row.customer,
    row.supplier,
    row.mine,
    row.vehicleNo,
    row.biltyNo,
    csvDecimal(row.weight),
    csvDecimal(row.purchaseRate),
    csvDecimal(row.buyAmount),
    csvDecimal(row.sellRate),
    csvDecimal(row.sellAmount),
    csvDecimal(row.profit),
  ]);
  rows.push([
    copy.total,
    null,
    null,
    null,
    null,
    null,
    null,
    csvDecimal(totals.weight),
    null,
    csvDecimal(totals.purchases),
    null,
    csvDecimal(totals.sales),
    csvDecimal(totals.profit),
  ]);
  return renderCsv(salesHeader, rows);
}

export function renderSalesDetailsPdf(
  data: SalesData,
  metadata: ExportDocumentMetadata,
) {
  const { profile } = metadata;
  const decimal = (value: string, scale: 2 | 3 = 2) =>
    formatDecimal(value, scale, profile.numberFormat);
  const money = profile.currencySymbol;
  const columns: PdfTableColumn[] = [
    { label: copy.orderNo, weight: 1.2, singleLine: true },
    { label: copy.date, weight: 1.08, singleLine: true },
    { label: copy.customer, weight: 1.47 },
    { label: copy.supplier, weight: 1.47 },
    { label: copy.mine, weight: 0.8 },
    { label: copy.vehicleBilty, weight: 1.23 },
    {
      label: `${copy.weight} (${settings.weightUnits[profile.weightUnit]})`,
      weight: 0.97,
      number: true,
    },
    { label: `${copy.purchase} (${money})`, weight: 1.2, number: true },
    { label: `${copy.sale} (${money})`, weight: 1.2, number: true },
    { label: `${copy.profit} (${money})`, weight: 1.1, number: true },
  ];
  const rows = data.rows.map((row) => [
    row.orderNo,
    formatDocumentDate(parseBusinessDate(row.businessDate), profile.dateFormat),
    row.customer,
    row.supplier,
    row.mine,
    row.biltyNo ? [row.vehicleNo, row.biltyNo] : row.vehicleNo,
    decimal(row.weight, 3),
    [decimal(row.purchaseRate), decimal(row.buyAmount)],
    [decimal(row.sellRate), decimal(row.sellAmount)],
    decimal(row.profit),
  ]);
  const { totals } = data;
  const totalRow = [
    copy.total,
    "",
    "",
    "",
    "",
    "",
    decimal(totals.weight, 3),
    decimal(totals.purchases),
    decimal(totals.sales),
    decimal(totals.profit),
  ];

  return renderTablePdf({
    ...metadata,
    title: messages.nav.salesDetails,
    subtitle: exportSubtitle(
      profile,
      data.filters.period,
      data.total,
      data.filters.q,
    ),
    columns,
    rows,
    totalRows: [totalRow],
    emptyMessage: copy.empty,
  });
}

const ledgerHeader = [
  copy.date,
  copy.refNo,
  copy.type,
  copy.party,
  copy.vehicleBank,
  copy.mineRef,
  copy.weight,
  copy.rate,
  copy.debit,
  copy.credit,
  copy.balance,
];

function statusLabel(row: PartyLedgerRow) {
  const type =
    row.paymentMethod === "ADJUSTMENT"
      ? ledgerMessages.activity.CUSTOMER_ADJUSTMENT
      : ledgerMessages.activity[row.kind];
  return row.isReversal ? copy.reversed(type) : type;
}

export function renderPartyLedgerCsv(data: LedgerData) {
  const { summary, party } = data;
  const rows = data.rows.map((row) => [
    row.businessDate,
    row.refNo,
    statusLabel(row),
    row.partyName,
    row.vehicleOrBank,
    row.mineOrReference,
    csvDecimal(row.weight),
    csvDecimal(row.rate),
    csvDecimal(row.debit),
    csvDecimal(row.credit),
    csvDecimal(row.balance),
  ]);
  rows.push(
    [
      copy.opening,
      null,
      null,
      party.name,
      null,
      null,
      null,
      null,
      null,
      null,
      csvDecimal(summary.openingBalance),
    ],
    [
      copy.periodTotals,
      null,
      null,
      party.name,
      null,
      null,
      csvDecimal(summary.weight),
      null,
      csvDecimal(summary.billed),
      csvDecimal(summary.settled),
      null,
    ],
    [
      copy.closing,
      null,
      null,
      party.name,
      null,
      null,
      null,
      null,
      null,
      null,
      csvDecimal(summary.closingBalance),
    ],
  );
  if (summary.adjustments !== "0.00") {
    rows.splice(-1, 0, [
      copy.adjustments,
      null,
      null,
      party.name,
      null,
      null,
      null,
      null,
      null,
      null,
      csvDecimal(summary.adjustments),
    ]);
  }
  return renderCsv(ledgerHeader, rows);
}

export function renderPartyLedgerPdf(
  kind: LedgerParty,
  data: LedgerData,
  metadata: ExportDocumentMetadata,
  title: string = kind === "customer"
    ? messages.nav.customerDetails
    : messages.nav.supplierDetails,
) {
  const { profile } = metadata;
  const { summary, party } = data;
  const decimal = (value: string | null, scale: 2 | 3 = 2) =>
    value === null
      ? documentPrint.missing
      : formatDecimal(value, scale, profile.numberFormat);
  const money = profile.currencySymbol;
  const unit = settings.weightUnits[profile.weightUnit];
  const columns: PdfTableColumn[] = [
    { label: copy.date, weight: 1.1, singleLine: true },
    { label: copy.refNo, weight: 1.28, singleLine: true },
    { label: copy.type, weight: 1.1 },
    { label: copy.vehicleBank, weight: 1.32 },
    { label: copy.mineRef, weight: 1.22 },
    { label: `${copy.weightRate} (${unit})`, weight: 1.02, number: true },
    { label: `${copy.debit} (${money})`, weight: 1.12, number: true },
    { label: `${copy.credit} (${money})`, weight: 1.12, number: true },
    { label: `${copy.balance} (${money})`, weight: 1.12, number: true },
  ];
  const rows = data.rows.map((row) => [
    formatDocumentDate(parseBusinessDate(row.businessDate), profile.dateFormat),
    row.refNo ?? documentPrint.missing,
    statusLabel(row),
    row.vehicleOrBank ?? documentPrint.missing,
    row.mineOrReference ?? documentPrint.missing,
    row.rate === null
      ? decimal(row.weight, 3)
      : [decimal(row.weight, 3), decimal(row.rate)],
    decimal(row.debit),
    decimal(row.credit),
    decimal(row.balance),
  ]);
  return renderTablePdf({
    ...metadata,
    title,
    subtitle: exportSubtitle(
      profile,
      data.filters.period,
      data.matchedCount,
      data.filters.q,
      [`${party.code} - ${party.name}`, copy.tabs[data.filters.tab]],
    ),
    columns,
    rows,
    totalRows: [
      [
        copy.opening,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        decimal(summary.openingBalance),
      ],
      [
        copy.periodTotals,
        "",
        "",
        "",
        "",
        decimal(summary.weight, 3),
        decimal(summary.billed),
        decimal(summary.settled),
        "",
      ],
      ...(summary.adjustments !== "0.00"
        ? [
            [
              copy.adjustments,
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              decimal(summary.adjustments),
            ],
          ]
        : []),
      [
        copy.closing,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        decimal(summary.closingBalance),
      ],
    ],
    emptyMessage: copy.empty,
  });
}

async function readDetailsExport(
  tx: Prisma.TransactionClient,
  actor: SessionActor,
  kind: DetailKind,
  filters: URLSearchParams,
  limit: number,
  now: Date,
): Promise<FilteredExportDocument> {
  if (kind === "sales") {
    const data = await readSalesDetailsExport(
      tx,
      actor,
      Object.fromEntries(filters),
      limit,
    );
    return {
      count: data.total,
      filename: "sales-details",
      targetType: "sales_details",
      csv: () => salesCsv(data),
      pdf: (metadata) => renderSalesDetailsPdf(data, metadata),
    };
  }
  const data = await readPartyLedger(
    tx,
    kind,
    parsePartyLedgerFilters(filters, now),
    limit,
  );
  if (!data) throw new FilteredExportError(copy.missingParty, 404);
  return {
    count: data.matchedCount,
    filename: `${kind}-ledger-${data.party.code}`,
    targetType: `${kind}_ledger`,
    targetId: data.party.id,
    csv: () => renderPartyLedgerCsv(data),
    pdf: (metadata) => renderPartyLedgerPdf(kind, data, metadata),
  };
}

export async function exportDetails(
  database: PrismaClient,
  actor: SessionActor,
  kind: DetailKind,
  params: URLSearchParams,
  context: PrintContext,
  now = new Date(),
) {
  try {
    return await exportFilteredDocument(
      database,
      actor,
      params,
      context,
      {
        area: "details",
        load: (tx, filters, limit, instant) =>
          readDetailsExport(tx, actor, kind, filters, limit, instant),
      },
      now,
    );
  } catch (error) {
    if (
      error instanceof SalesFiltersError ||
      error instanceof ReportPeriodError
    ) {
      return printTextResponse(copy.invalid, 400);
    }
    throw error;
  }
}
