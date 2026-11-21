import { getRequestContext, requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { renderDispatchSlip } from "@/server/orders/dispatch-pdf";
import { readDispatchSlip } from "@/server/orders/print";
import {
  pdfResponse,
  printErrorResponse,
} from "@/server/orders/print-response";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireActor();
  const { id } = await params;
  try {
    const data = await readDispatchSlip(
      getDatabase(),
      actor,
      id,
      await getRequestContext(),
    );
    return pdfResponse(
      await renderDispatchSlip(data),
      `dispatch-${data.row.orderNo}`,
    );
  } catch (error) {
    return printErrorResponse(error);
  }
}
