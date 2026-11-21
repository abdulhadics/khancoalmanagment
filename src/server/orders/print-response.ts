import { PermissionDenied } from "@/domain/permissions";
import { dispatchPrint } from "@/i18n/messages/dispatch-print-en";
import { DispatchPrintError } from "./print";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function pdfResponse(body: Uint8Array<ArrayBuffer>, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return new Response(body, {
    headers: {
      ...responseHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}.pdf"`,
    },
  });
}

export function printErrorResponse(error: unknown) {
  if (error instanceof PermissionDenied) {
    return new Response(dispatchPrint.unavailable, {
      status: 404,
      headers: responseHeaders,
    });
  }
  if (!(error instanceof DispatchPrintError)) throw error;
  const status = {
    unavailable: 404,
    invalidDate: 400,
    tooMany: 422,
    rateLimited: 429,
  }[error.code];
  return new Response(dispatchPrint[error.code], {
    status,
    headers: {
      ...responseHeaders,
      ...(status === 429 && { "Retry-After": "300" }),
    },
  });
}
