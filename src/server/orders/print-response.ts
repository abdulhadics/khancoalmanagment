import { dispatchPrint } from "@/i18n/messages/dispatch-print-en";
import { documentPrint } from "@/i18n/messages/print-en";
import {
  accessErrorResponse,
  printTextResponse,
} from "@/server/documents/print-response";
import { DispatchPrintError } from "./print";

export function printErrorResponse(error: unknown) {
  const accessError = accessErrorResponse(error);
  if (accessError) return accessError;
  if (!(error instanceof DispatchPrintError)) throw error;
  if (error.code === "unavailable")
    return printTextResponse(documentPrint.unavailable, 404);
  return printTextResponse(
    dispatchPrint[error.code],
    error.code === "invalidDate" ? 400 : 422,
  );
}
