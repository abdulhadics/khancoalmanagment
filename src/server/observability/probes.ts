import { internalRequestIdHeader, requestIdFromHeader } from "./requests";

type Probe = "liveness" | "readiness";
type ProbeMetrics = { checks: number; failures: number; maxDurationMs: number };
type ProbeResult =
  | boolean
  | { ready: true }
  | { ready: false; reason: string; fields?: string[] };

const initialMetrics = (): ProbeMetrics => ({
  checks: 0,
  failures: 0,
  maxDurationMs: 0,
});
const processMetrics: Record<Probe, ProbeMetrics> = {
  liveness: initialMetrics(),
  readiness: initialMetrics(),
};

export async function respondToProbe(
  request: Request,
  probe: Probe,
  check: () => ProbeResult | Promise<ProbeResult>,
) {
  const started = performance.now();
  const result = await check();
  const ok = typeof result === "boolean" ? result : result.ready;
  const diagnostic =
    typeof result !== "boolean" && !result.ready
      ? { reason: result.reason, fields: result.fields }
      : undefined;
  const durationMs = Math.round(performance.now() - started);
  const status = probe === "liveness" ? "ok" : ok ? "ready" : "not_ready";
  const totals = processMetrics[probe];
  totals.checks++;
  if (!ok) totals.failures++;
  totals.maxDurationMs = Math.max(totals.maxDurationMs, durationMs);
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "health.probe",
      requestId: requestIdFromHeader(
        request.headers.get(internalRequestIdHeader),
      ),
      probe,
      status,
      ...(diagnostic && { diagnostic }),
      durationMs,
      ...totals,
    }),
  );
  return Response.json(
    { status },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
