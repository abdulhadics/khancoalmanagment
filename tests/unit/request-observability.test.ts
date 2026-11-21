import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { proxy } from "../../src/proxy";
import { respondToProbe } from "../../src/server/observability/probes";
import {
  internalRequestIdHeader,
  requestLogRecord,
} from "../../src/server/observability/requests";

afterEach(() => vi.restoreAllMocks());

it("overwrites caller-provided request IDs and logs only allowlisted route data", () => {
  const recorder = vi.spyOn(console, "info").mockImplementation(() => {});
  const suppliedId = "1dbdd84c-7cff-4997-955a-fbd74014dab8";
  const orderId = "06df042f-2efe-4947-a6a6-6b09c04afcfb";
  const url = new URL(`/orders/${orderId}/slip`, "http://127.0.0.1:3000");
  url.searchParams.set("token", "test-token");
  const request = new NextRequest(url, {
    headers: {
      [internalRequestIdHeader]: suppliedId,
      cookie: "session=test-cookie",
    },
  });
  const response = proxy(request);
  const responseId = response.headers.get("X-Request-ID");
  expect(responseId).toMatch(/^[a-f\d-]{36}$/);
  expect(responseId).not.toBe(suppliedId);
  expect(
    response.headers.get(`x-middleware-request-${internalRequestIdHeader}`),
  ).toBe(responseId);
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "'strict-dynamic'",
  );
  const message = recorder.mock.calls[0][0];
  expect(JSON.parse(message)).toEqual({
    timestamp: expect.any(String),
    event: "request.received",
    requestId: responseId,
    method: "GET",
    route: "/orders/:id/slip",
  });
  for (const value of [suppliedId, orderId, "test-token", "test-cookie"])
    expect(message).not.toContain(value);
});

it("masks unknown paths and methods in framework-error logs", () => {
  const record = requestLogRecord("request.failed", {
    path: "/reports/secret-data?leak=secret-key",
    method: "custom-value",
    requestId: "raw-inbound-id",
  });
  expect(record).toEqual({
    timestamp: expect.any(String),
    event: "request.failed",
    requestId: expect.stringMatching(/^[a-f\d-]{36}$/),
    method: "OTHER",
    route: "other",
  });
  expect(JSON.stringify(record)).not.toMatch(
    /secret|custom-value|raw-inbound-id/,
  );
});

it("records minimal readiness metrics without adding details to the public payload", async () => {
  const recorder = vi.spyOn(console, "info").mockImplementation(() => {});
  const requestId = "1dbdd84c-7cff-4997-955a-fbd74014dab8";
  const request = new Request("http://127.0.0.1:3000/readyz", {
    headers: { [internalRequestIdHeader]: requestId },
  });
  const bad = await respondToProbe(request, "readiness", () => false);
  const good = await respondToProbe(request, "readiness", async () => true);
  expect(bad.status).toBe(503);
  expect(await bad.json()).toEqual({ status: "not_ready" });
  expect(good.status).toBe(200);
  expect(await good.json()).toEqual({ status: "ready" });
  expect(good.headers.get("Cache-Control")).toBe("no-store");
  expect(JSON.parse(recorder.mock.calls[1][0])).toEqual({
    timestamp: expect.any(String),
    event: "health.probe",
    requestId,
    probe: "readiness",
    status: "ready",
    durationMs: expect.any(Number),
    checks: 2,
    failures: 1,
    maxDurationMs: expect.any(Number),
  });
});
