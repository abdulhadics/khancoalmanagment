import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  internalRequestIdHeader,
  logRequest,
} from "./server/observability/requests";

export function proxy(request: NextRequest) {
  const requestId = randomUUID();
  const nonce = randomBytes(18).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const deployed = process.env.DEPLOYMENT_ENV === "production";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws://127.0.0.1:*" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(deployed ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(internalRequestIdHeader, requestId);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("X-Request-ID", requestId);
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set("Cache-Control", "private, no-store");
  if (deployed) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  const pathname = request.nextUrl.pathname;
  if (pathname !== "/healthz" && pathname !== "/readyz") {
    logRequest("request.received", {
      path: pathname,
      method: request.method,
      requestId,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
