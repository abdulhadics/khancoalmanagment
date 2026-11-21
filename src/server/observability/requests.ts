export const internalRequestIdHeader = "x-kc-request-id";

const requestIdPattern =
  /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const recordIdPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

const staticRoutes = new Set([
  "/",
  "/account",
  "/admin/audit",
  "/admin/backups",
  "/admin/backups/download",
  "/admin/integrity",
  "/admin/periods",
  "/customers",
  "/customers/new",
  "/forgot-password",
  "/healthz",
  "/login",
  "/login/change-password",
  "/login/two-factor",
  "/login/verify",
  "/orders",
  "/orders/print",
  "/profile",
  "/readyz",
  "/reset-password",
  "/settings",
  "/settings/users",
  "/settings/users/new",
  "/suppliers",
  "/suppliers/new",
]);

const methods = new Set([
  "GET",
  "POST",
  "HEAD",
  "OPTIONS",
  "PUT",
  "DELETE",
  "PATCH",
]);
const details = new Set(["sales", "customers", "suppliers"]);
const reports = new Set([...details, "customer", "supplier"]);

export function requestIdFromHeader(
  value: string | string[] | null | undefined,
) {
  return typeof value === "string" && requestIdPattern.test(value)
    ? value
    : crypto.randomUUID();
}

function routeLabel(rawPath: string) {
  const pathname = rawPath.split("?", 1)[0];
  if (!pathname.startsWith("/")) return "other";
  if (staticRoutes.has(pathname)) return pathname;
  const [, area, section, leaf, extra] = pathname.split("/");
  if (extra !== undefined) return "other";
  if (
    area === "details" &&
    details.has(section) &&
    (leaf === undefined || leaf === "export")
  )
    return pathname;
  if (
    area === "reports" &&
    reports.has(section) &&
    (leaf === undefined || leaf === "export")
  )
    return pathname;
  if (area === "settings" && section === "users" && recordIdPattern.test(leaf))
    return "/settings/users/:id";
  if (
    area === "account" &&
    section === "vouchers" &&
    recordIdPattern.test(leaf)
  )
    return "/account/vouchers/:id";
  if (recordIdPattern.test(section)) {
    if (area === "customers" && leaf === undefined) return "/customers/:id";
    if (area === "suppliers" && leaf === undefined) return "/suppliers/:id";
    if (area === "orders" && (leaf === "edit" || leaf === "slip"))
      return `/orders/:id/${leaf}`;
  }
  return "other";
}

export function requestLogRecord(
  event: "request.received" | "request.failed",
  input: {
    path: string;
    method: string;
    requestId?: string | string[] | null;
  },
) {
  return {
    timestamp: new Date().toISOString(),
    event,
    requestId: requestIdFromHeader(input.requestId),
    method: methods.has(input.method) ? input.method : "OTHER",
    route: routeLabel(input.path),
  };
}

export function logRequest(
  event: "request.received" | "request.failed",
  input: Parameters<typeof requestLogRecord>[1],
) {
  const message = JSON.stringify(requestLogRecord(event, input));
  if (event === "request.failed") console.error(message);
  else console.info(message);
}
