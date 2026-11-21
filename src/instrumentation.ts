import type { Instrumentation } from "next";
import {
  internalRequestIdHeader,
  logRequest,
} from "./server/observability/requests";

export const onRequestError: Instrumentation.onRequestError = (
  _error,
  request,
) => {
  logRequest("request.failed", {
    path: request.path,
    method: request.method,
    requestId: request.headers[internalRequestIdHeader],
  });
};
