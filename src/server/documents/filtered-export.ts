import { parseBusinessDate } from "@/domain/business-date";
import { formatDocumentDate } from "@/domain/document-format";
import { formatDecimal } from "@/domain/number-display";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { detailsExport as copy } from "@/i18n/messages/details-export-en";
import { documentPrint } from "@/i18n/messages/print-en";
import type { SessionActor } from "@/server/auth/session";
import { appendAuditEvent } from "@/server/repositories/audit-log";
import {
  documentProfileFields,
  readDocumentForPrint,
  type DocumentProfile,
  type PrintContext,
} from "./print-data";
import {
  accessErrorResponse,
  csvResponse,
  pdfResponse,
  printTextResponse,
} from "./print-response";

type Format = "csv" | "pdf";
const limits = { pdf: 1_000, csv: 10_000 } as const;

export type ExportDocumentMetadata = {
  profile: DocumentProfile;
  generatedAt: Date;
  preparedBy: string;
};

export type FilteredExportDocument = {
  count: number;
  filename: string;
  targetType: string;
  targetId?: string;
  csv: () => Uint8Array<ArrayBuffer>;
  pdf: (metadata: ExportDocumentMetadata) => Promise<Uint8Array<ArrayBuffer>>;
};

export class FilteredExportError extends Error {
  constructor(
    readonly message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FilteredExportError";
  }
}

function exportQuery(params: URLSearchParams): {
  format: Format;
  filters: URLSearchParams;
} {
  const format = params.get("format");
  if (format !== "csv" && format !== "pdf")
    throw new FilteredExportError(copy.invalid, 400);
  const keys = new Set<string>();
  for (const [key, value] of params) {
    if (keys.has(key) || value.includes("\0"))
      throw new FilteredExportError(copy.invalid, 400);
    keys.add(key);
  }
  const filters = new URLSearchParams(params);
  filters.delete("format");
  filters.delete("page");
  filters.delete("pageSize");
  return { format, filters };
}

export function exportSubtitle(
  profile: DocumentProfile,
  period: { from?: string; to?: string },
  count: number,
  query: string,
  extra: string[] = [],
) {
  const display = (date: string) =>
    formatDocumentDate(parseBusinessDate(date), profile.dateFormat);
  const from = period.from && display(period.from);
  const to = period.to && display(period.to);
  const dates =
    from && to
      ? copy.range(from, to)
      : from
        ? copy.from(from)
        : to
          ? copy.through(to)
          : copy.allDates;
  return [
    ...extra,
    dates,
    copy.resultCount(formatDecimal(BigInt(count), 0, profile.numberFormat)),
    ...(query ? [copy.filter(query)] : []),
  ].join("  |  ");
}

type ExportSource = {
  area: "details" | "reports";
  load: (
    tx: Prisma.TransactionClient,
    filters: URLSearchParams,
    limit: number,
    now: Date,
  ) => Promise<FilteredExportDocument>;
};

export async function exportFilteredDocument(
  database: PrismaClient,
  actor: SessionActor,
  params: URLSearchParams,
  context: PrintContext,
  source: ExportSource,
  now = new Date(),
): Promise<Response> {
  try {
    const { format, filters } = exportQuery(params);
    const limit = limits[format];
    const { document, profile } = await readDocumentForPrint(
      database,
      actor,
      "reports.export",
      context,
      now,
      async (tx) => {
        const document = await source.load(tx, filters, limit, now);
        if (document.count > limit) {
          throw new FilteredExportError(
            copy.tooMany(formatDecimal(BigInt(limit), 0)),
            422,
          );
        }
        const company = await tx.companySettings.findUnique({
          where: { id: 1 },
          select: { documentProfile: { select: documentProfileFields } },
        });
        if (!company)
          throw new FilteredExportError(documentPrint.unavailable, 404);
        await appendAuditEvent(tx, {
          ...context,
          actor: { type: "USER", id: actor.userId },
          area: source.area,
          action: `${source.area}.export`,
          targetType: document.targetType,
          targetId: document.targetId,
          outcome: "SUCCESS",
          after: { format, records: document.count },
        });
        return { document, profile: company.documentProfile };
      },
    );
    if (format === "csv") return csvResponse(document.csv(), document.filename);
    const bytes = await document.pdf({
      profile,
      generatedAt: now,
      preparedBy: actor.displayName,
    });
    return pdfResponse(bytes, document.filename);
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    if (error instanceof FilteredExportError) {
      return printTextResponse(error.message, error.status);
    }
    throw error;
  }
}
