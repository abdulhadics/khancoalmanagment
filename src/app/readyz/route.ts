import { isDatabaseReady } from "@/server/db/readiness";
import { respondToProbe } from "@/server/observability/probes";

export function GET(request: Request) {
  return respondToProbe(request, "readiness", isDatabaseReady);
}
