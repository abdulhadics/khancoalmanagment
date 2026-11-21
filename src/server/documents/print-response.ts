import { PermissionDenied } from "@/domain/permissions";
import { documentPrint } from "@/i18n/messages/print-en";
import { DocumentPrintThrottled } from "./print-data";

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

export function printTextResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      ...responseHeaders,
      ...(status === 429 && { "Retry-After": "300" }),
    },
  });
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof PermissionDenied) {
    return printTextResponse(documentPrint.unavailable, 404);
  }
  if (error instanceof DocumentPrintThrottled) {
    return printTextResponse(documentPrint.rateLimited, 429);
  }
  return null;
}
