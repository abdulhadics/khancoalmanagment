import { respondToProbe } from "@/server/observability/probes";

export function GET(request: Request) {
  return respondToProbe(request, "liveness", () => true);
}
