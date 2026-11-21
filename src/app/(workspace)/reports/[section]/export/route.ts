import { documentPrint } from "@/i18n/messages/print-en";
import { getRequestContext, requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { printTextResponse } from "@/server/documents/print-response";
import { exportReport, type ReportSection } from "@/server/reporting/exports";

export const runtime = "nodejs";

const sections: readonly ReportSection[] = [
  "sales",
  "customers",
  "customer",
  "suppliers",
  "supplier",
];

function isReportSection(value: string): value is ReportSection {
  return sections.some((section) => section === value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ section: string }> },
) {
  const { section } = await params;
  if (!isReportSection(section))
    return printTextResponse(documentPrint.unavailable, 404);
  const actor = await requireActor();
  return exportReport(
    getDatabase(),
    actor,
    section,
    new URL(request.url).searchParams,
    await getRequestContext(),
  );
}
