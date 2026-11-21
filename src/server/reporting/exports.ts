import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatDecimal } from "@/domain/number-display";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { messages } from "@/i18n";
import { detailsExport as copy } from "@/i18n/messages/details-export-en";
import { documentPrint } from "@/i18n/messages/print-en";
import { reportExport as report } from "@/i18n/messages/report-export-en";
import { settings } from "@/i18n/messages/settings-en";
import type { SessionActor } from "@/server/auth/session";
import {
  renderPartyLedgerCsv,
  renderPartyLedgerPdf,
} from "@/server/details/exports";
import {
  readPartyLedger,
  type LedgerParty,
} from "@/server/details/party-ledger";
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
import type {
  DocumentProfile,
  PrintContext,
} from "@/server/documents/print-data";
import { printTextResponse } from "@/server/documents/print-response";
import {
  parsePartySummaryFilters,
  parseSinglePartyReportFilters,
  readPartySummaryReport,
  type PartySummaryMetrics,
} from "./party-summary";
import { ReportPeriodError } from "./period";
import { SalesFiltersError } from "./sales-details";
import type { SalesTotals } from "./sales-facts";
import {
  readSalesReportExport,
  type SalesReportGroup,
  type SalesReportRow,
} from "./sales-report";

export type ReportSection =
  "sales" | "customers" | "customer" | "suppliers" | "supplier";
type SalesReport = Awaited<ReturnType<typeof readSalesReportExport>>;
type PartyReport = Awaited<ReturnType<typeof readPartySummaryReport>>;

type Measure<T> = {
  field: keyof T;
  label: string;
  scale: 0 | 2 | 3;
  width: number;
};

const salesMeasures: readonly Measure<SalesTotals>[] = [
  { field: "trucks", label: report.trucks, scale: 0, width: 0.67 },
  { field: "weight", label: copy.weight, scale: 3, width: 0.92 },
  { field: "sales", label: report.sales, scale: 2, width: 1.06 },
  { field: "purchases", label: report.purchases, scale: 2, width: 1.06 },
  { field: "profit", label: report.profit, scale: 2, width: 1.06 },
];

function partyMeasures(
  kind: LedgerParty,
): readonly Measure<PartySummaryMetrics>[] {
  const customer = kind === "customer";
  return [
    { field: "trucks", label: report.trucks, scale: 0, width: 0.66 },
    { field: "weight", label: copy.weight, scale: 3, width: 0.91 },
    { field: "openingBalance", label: report.openings, scale: 2, width: 1.12 },
    {
      field: "billed",
      label: customer ? report.sales : report.purchases,
      scale: 2,
      width: 1.12,
    },
    {
      field: "settled",
      label: customer ? report.receipts : report.payments,
      scale: 2,
      width: 1.12,
    },
    { field: "adjustments", label: report.adjustments, scale: 2, width: 1.06 },
    {
      field: "closingBalance",
      label: report.closings[kind],
      scale: 2,
      width: 1.18,
    },
  ];
}

function csvMeasures<T>(measures: readonly Measure<T>[], record: T) {
  return measures.map(({ field }) => csvDecimal(String(record[field])));
}

function pdfMeasures<T>(
  measures: readonly Measure<T>[],
  record: T,
  profile: DocumentProfile,
) {
  return measures.map(({ field, scale }) =>
    formatDecimal(String(record[field]), scale, profile.numberFormat),
  );
}

function measureColumns<T>(
  measures: readonly Measure<T>[],
  profile: DocumentProfile,
): PdfTableColumn[] {
  const unit = settings.weightUnits[profile.weightUnit];
  return measures.map(({ label, scale, width }) => ({
    label:
      scale === 0
        ? label
        : `${label} (${scale === 3 ? unit : profile.currencySymbol})`,
    weight: width,
    number: true,
  }));
}

function salesIdentityColumns(group: SalesReportGroup): PdfTableColumn[] {
  return group === "entry"
    ? [
        { label: report.groups.entry, weight: 1.17, singleLine: true },
        { label: copy.date, weight: 1.12, singleLine: true },
        { label: copy.customer, weight: 1.42 },
        { label: copy.supplier, weight: 1.42 },
        { label: copy.mine, weight: 0.79 },
        { label: copy.vehicle, weight: 0.93 },
      ]
    : [
        {
          label: report.groups[group],
          weight: 3.1,
          singleLine: group === "date",
        },
      ];
}

function salesIdentity(
  row: SalesReportRow,
  group: SalesReportGroup,
  profile?: DocumentProfile,
) {
  const date =
    row.businessDate && profile
      ? formatDocumentDate(
          parseBusinessDate(row.businessDate),
          profile.dateFormat,
        )
      : row.businessDate;
  if (group === "entry")
    return [
      row.label,
      date,
      row.customer,
      row.supplier,
      row.mine,
      row.vehicleNo,
    ];
  return [group === "date" ? (date ?? row.label) : row.label];
}

function salesReportCsv(data: SalesReport) {
  const { groupBy } = data.filters;
  const identity = salesIdentityColumns(groupBy);
  return renderCsv(
    [
      ...identity.map(({ label }) => label),
      ...salesMeasures.map(({ label }) => label),
    ],
    [
      ...data.rows.map((row) => [
        ...salesIdentity(row, groupBy),
        ...csvMeasures(salesMeasures, row),
      ]),
      [
        report.grandTotal,
        ...identity.slice(1).map(() => null),
        ...csvMeasures(salesMeasures, data.totals),
      ],
    ],
  );
}

export function renderSalesReportPdf(
  data: SalesReport,
  metadata: ExportDocumentMetadata,
) {
  const { profile } = metadata;
  const { groupBy, period } = data.filters;
  const identity = salesIdentityColumns(groupBy);
  return renderTablePdf({
    ...metadata,
    title: messages.nav.salesReport,
    subtitle: exportSubtitle(profile, period, data.total, "", [
      report.grouped(report.groups[groupBy]),
    ]),
    columns: [...identity, ...measureColumns(salesMeasures, profile)],
    rows: data.rows.map((row) => [
      ...salesIdentity(row, groupBy, profile).map(
        (value) => value ?? documentPrint.missing,
      ),
      ...pdfMeasures(salesMeasures, row, profile),
    ]),
    totalRows: [
      [
        report.grandTotal,
        ...identity.slice(1).map(() => ""),
        ...pdfMeasures(salesMeasures, data.totals, profile),
      ],
    ],
    emptyMessage: copy.empty,
  });
}

function partyReportCsv(kind: LedgerParty, data: PartyReport) {
  const measures = partyMeasures(kind);
  const party = kind === "customer" ? copy.customer : copy.supplier;
  return renderCsv(
    [report.code, party, ...measures.map(({ label }) => label)],
    [
      ...data.rows.map((row) => [
        row.code,
        row.name,
        ...csvMeasures(measures, row),
      ]),
      [report.grandTotal, "", ...csvMeasures(measures, data.totals)],
    ],
  );
}

export function renderPartySummaryPdf(
  kind: LedgerParty,
  data: PartyReport,
  metadata: ExportDocumentMetadata,
) {
  const measures = partyMeasures(kind);
  const customer = kind === "customer";
  const { profile } = metadata;
  return renderTablePdf({
    ...metadata,
    title: customer
      ? messages.nav.customersReport
      : messages.nav.suppliersReport,
    subtitle: exportSubtitle(
      profile,
      data.filters.period,
      data.matchedCount,
      data.filters.q,
    ),
    columns: [
      { label: report.code, weight: 0.96, singleLine: true },
      { label: customer ? copy.customer : copy.supplier, weight: 2.25 },
      ...measureColumns(measures, profile),
    ],
    rows: data.rows.map((row) => [
      row.code,
      row.name,
      ...pdfMeasures(measures, row, profile),
    ]),
    totalRows: [
      [report.grandTotal, "", ...pdfMeasures(measures, data.totals, profile)],
    ],
    emptyMessage: copy.empty,
  });
}

async function loadReportExport(
  tx: Prisma.TransactionClient,
  actor: SessionActor,
  section: ReportSection,
  filters: URLSearchParams,
  limit: number,
  now: Date,
): Promise<FilteredExportDocument> {
  if (section === "sales") {
    const data = await readSalesReportExport(
      tx,
      actor,
      Object.fromEntries(filters),
      limit,
    );
    return {
      count: data.total,
      filename: "sales-report",
      targetType: "sales_report",
      csv: () => salesReportCsv(data),
      pdf: (metadata) => renderSalesReportPdf(data, metadata),
    };
  }
  if (section === "customers" || section === "suppliers") {
    const party = section === "customers" ? "customer" : "supplier";
    const data = await readPartySummaryReport(
      tx,
      party,
      parsePartySummaryFilters(filters, now),
      limit,
    );
    return {
      count: data.matchedCount,
      filename: `${section}-report`,
      targetType: `${section}_report`,
      csv: () => partyReportCsv(party, data),
      pdf: (metadata) => renderPartySummaryPdf(party, data, metadata),
    };
  }
  const data = await readPartyLedger(
    tx,
    section,
    parseSinglePartyReportFilters(filters, now),
    limit,
  );
  if (!data) throw new FilteredExportError(copy.missingParty, 404);
  const title =
    section === "customer"
      ? messages.nav.singleCustomerReport
      : messages.nav.singleSupplierReport;
  return {
    count: data.matchedCount,
    filename: `${section}-report-${data.party.code}`,
    targetType: `${section}_report`,
    targetId: data.party.id,
    csv: () => renderPartyLedgerCsv(data),
    pdf: (metadata) => renderPartyLedgerPdf(section, data, metadata, title),
  };
}

export async function exportReport(
  database: PrismaClient,
  actor: SessionActor,
  section: ReportSection,
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
        area: "reports",
        load: (tx, filters, limit, instant) =>
          loadReportExport(tx, actor, section, filters, limit, instant),
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
