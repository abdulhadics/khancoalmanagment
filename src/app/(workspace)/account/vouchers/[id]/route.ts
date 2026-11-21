import { documentPrint } from "@/i18n/messages/print-en";
import { readPaymentVoucher } from "@/server/account/voucher";
import { renderPaymentVoucher } from "@/server/account/voucher-pdf";
import { getRequestContext, requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  accessErrorResponse,
  pdfResponse,
  printTextResponse,
} from "@/server/documents/print-response";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireActor();
  const { id } = await params;
  try {
    const data = await readPaymentVoucher(
      getDatabase(),
      actor,
      id,
      await getRequestContext(),
    );
    if (!data) return printTextResponse(documentPrint.unavailable, 404);
    return pdfResponse(
      await renderPaymentVoucher(data),
      `voucher-${data.voucherNo}`,
    );
  } catch (error) {
    const failure = accessErrorResponse(error);
    if (failure) return failure;
    throw error;
  }
}
