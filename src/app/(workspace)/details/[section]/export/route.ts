import { documentPrint } from "@/i18n/messages/print-en";
import { getRequestContext, requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { exportDetails } from "@/server/details/exports";
import { printTextResponse } from "@/server/documents/print-response";

export const runtime = "nodejs";

const detailsSections = {
  sales: "sales",
  customers: "customer",
  suppliers: "supplier",
} as const;

function isDetailsSection(
  value: string,
): value is keyof typeof detailsSections {
  return Object.hasOwn(detailsSections, value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ section: string }> },
) {
  const { section } = await params;
  if (!isDetailsSection(section))
    return printTextResponse(documentPrint.unavailable, 404);
  const actor = await requireActor();
  return exportDetails(
    getDatabase(),
    actor,
    detailsSections[section],
    new URL(request.url).searchParams,
    await getRequestContext(),
  );
}
