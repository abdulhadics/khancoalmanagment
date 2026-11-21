import { getRequestContext, requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { pdfResponse } from "@/server/documents/print-response";
import { renderDailyDispatch } from "@/server/orders/dispatch-pdf";
import { readDailyDispatch } from "@/server/orders/print";
import { printErrorResponse } from "@/server/orders/print-response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await requireActor();
  const date = new URL(request.url).searchParams.get("date") ?? "";
  try {
    const data = await readDailyDispatch(
      getDatabase(),
      actor,
      date,
      await getRequestContext(),
    );
    return pdfResponse(
      await renderDailyDispatch(data),
      `dispatch-register-${date}`,
    );
  } catch (error) {
    return printErrorResponse(error);
  }
}
