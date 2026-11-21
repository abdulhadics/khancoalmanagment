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
  renderTablePdf,
  type PdfTableColumn,
} from "@/server/documents/pdf-table";
import {
  documentProfileFields,
  readDocumentForPrint,
  type DocumentProfile,
  type PrintContext,
} from "@/server/documents/print-data";
import {
  accessErrorResponse,
  csvResponse,
  pdfResponse,
  printTextResponse,
} from "@/server/documents/print-response";
import {
  ReportPeriodError,
  type ReportPeriod,
} from "@/server/reporting/period";
import {
  readSalesDetailsExport,
  SalesFiltersError,
} from "@/server/reporting/sales-details";
import { appendAuditEvent } from "@/server/repositories/audit-log";
import {
  parsePartyLedgerFilters,
  readPartyLedger,
  type LedgerParty,
  type PartyLedgerRow,
} from "./party-ledger";

type DetailKind = "sales" | LedgerParty;
type Format = "csv" | "pdf";
type SalesData = Awaited<ReturnType<typeof readSalesDetailsExport>>;
type LedgerData = NonNullable<Awaited<ReturnType<typeof readPartyLedger>>>;
type ExportResult =
  { kind: "sales"; data: SalesData } | { kind: LedgerParty; data: LedgerData };
type Profile = {
  profile: DocumentProfile;
  generatedAt: Date;
  preparedBy: string;
};
const fileLimits = { pdf: 1_000, csv: 10_000 } as const;

class DetailsExportError extends Error {
  constructor(
    readonly message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DetailsExportError";
  }
}

function selectedQuery(params: URLSearchParams): {
  format: Format;
  filters: URLSearchParams;
} {
  const format = params.get("format");
  if (format !== "csv" && format !== "pdf")
    throw new DetailsExportError(copy.invalid, 400);
  for (const [key, value] of params) {
    if (params.getAll(key).length !== 1 || value.includes("\0")) {
      throw new DetailsExportError(copy.invalid, 400);
    }
  }
  const filters = new URLSearchParams(params);
  filters.delete("format");
  filters.delete("page");
  filters.delete("pageSize");
  return { format, filters };
}

function periodLabel(period: ReportPeriod, profile: DocumentProfile) {
  const display = (date: string) =>
    formatDocumentDate(parseBusinessDate(date), profile.dateFormat);
  if (period.from && period.to)
    return copy.range(display(period.from), display(period.to));
  if (period.from) return copy.from(display(period.from));
  if (period.to) return copy.through(display(period.to));
  return copy.allDates;
}

function summaryLabel(
  profile: DocumentProfile,
  period: ReportPeriod,
  count: number,
  query: string,
  extra: string[] = [],
) {
  return [
    ...extra,
    periodLabel(period, profile),
    copy.resultCount(formatDecimal(BigInt(count), 0, profile.numberFormat)),
    ...(query ? [copy.filter(query)] : []),
  ].join("  |  ");
}

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

export function renderSalesDetailsPdf(data: SalesData, metadata: Profile) {
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
    subtitle: summaryLabel(
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

function ledgerCsv(data: LedgerData) {
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
  metadata: Profile,
) {
  const { profile } = metadata;
  const { summary, party } = data;
  const title =
    kind === "customer"
      ? messages.nav.customerDetails
      : messages.nav.supplierDetails;
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
    subtitle: summaryLabel(
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
): Promise<ExportResult> {
  if (kind === "sales") {
    const data = await readSalesDetailsExport(
      tx,
      actor,
      Object.fromEntries(filters),
      limit,
    );
    return { kind, data };
  }
  const data = await readPartyLedger(
    tx,
    kind,
    parsePartyLedgerFilters(filters, now),
    limit,
  );
  if (!data) throw new DetailsExportError(copy.missingParty, 404);
  return { kind, data };
}

function matchingCount(result: ExportResult) {
  return result.kind === "sales" ? result.data.total : result.data.matchedCount;
}

function exportResponse(
  result: ExportResult,
  metadata: Profile,
  format: Format,
): Response | Promise<Response> {
  const filename =
    result.kind === "sales"
      ? "sales-details"
      : `${result.kind}-ledger-${result.data.party.code}`;
  if (format === "csv") {
    return csvResponse(
      result.kind === "sales" ? salesCsv(result.data) : ledgerCsv(result.data),
      filename,
    );
  }
  const pdf =
    result.kind === "sales"
      ? renderSalesDetailsPdf(result.data, metadata)
      : renderPartyLedgerPdf(result.kind, result.data, metadata);
  return pdf.then((bytes) => pdfResponse(bytes, filename));
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
    const { format, filters } = selectedQuery(params);
    const limit = fileLimits[format];
    const { result, profile } = await readDocumentForPrint(
      database,
      actor,
      "reports.export",
      context,
      now,
      async (tx) => {
        const result = await readDetailsExport(
          tx,
          actor,
          kind,
          filters,
          limit,
          now,
        );
        const count = matchingCount(result);
        if (count > limit)
          throw new DetailsExportError(
            copy.tooMany(formatDecimal(BigInt(limit), 0)),
            422,
          );
        const current = await tx.companySettings.findUnique({
          where: { id: 1 },
          select: { documentProfile: { select: documentProfileFields } },
        });
        if (!current)
          throw new DetailsExportError(documentPrint.unavailable, 404);
        await appendAuditEvent(tx, {
          ...context,
          actor: { type: "USER", id: actor.userId },
          area: "details",
          action: "details.export",
          targetType: kind === "sales" ? "sales_details" : `${kind}_ledger`,
          targetId: result.kind === "sales" ? undefined : result.data.party.id,
          outcome: "SUCCESS",
          after: { format, records: count },
        });
        return { result, profile: current.documentProfile };
      },
    );
    return exportResponse(
      result,
      { profile, generatedAt: now, preparedBy: actor.displayName },
      format,
    );
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    if (error instanceof DetailsExportError)
      return printTextResponse(error.message, error.status);
    if (
      error instanceof SalesFiltersError ||
      error instanceof ReportPeriodError
    ) {
      return printTextResponse(copy.invalid, 400);
    }
    throw error;
  }
}
