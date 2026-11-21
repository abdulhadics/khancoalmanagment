import { describe, expect, it, vi } from "vitest";

import { GET as health } from "../../src/app/healthz/route";
import { GET as ready } from "../../src/app/readyz/route";
import { readEnvironment } from "../../src/server/config/env";

describe("deployment configuration", () => {
  it("uses local defaults with the database optional", () => {
    expect(readEnvironment({})).toEqual({
      DEPLOYMENT_ENV: "development",
      APP_ORIGIN: "http://127.0.0.1:3000",
      APP_PORT: 3000,
    });
  });

  it("normalizes an origin and parses the configured port", () => {
    expect(
      readEnvironment({
        APP_ORIGIN: "https://coal.example.test/",
        APP_PORT: "3010",
      }),
    ).toMatchObject({
      APP_ORIGIN: "https://coal.example.test",
      APP_PORT: 3010,
    });
  });

  it("uses the configured port in the default local origin", () => {
    expect(readEnvironment({ APP_PORT: "3010" }).APP_ORIGIN).toBe(
      "http://127.0.0.1:3010",
    );
  });

  it.each(["", "1.2", "0", "65536", "port"])("rejects port %j", (APP_PORT) => {
    expect(() => readEnvironment({ APP_PORT })).toThrow(/APP_PORT/);
  });

  it.each([
    "ftp://coal.example.test",
    "https://coal.example.test/admin",
    "https://coal.example.test/?",
    "https://coal.example.test/#",
    "https://name:secret@coal.example.test",
  ])("rejects invalid origin %j", (APP_ORIGIN) => {
    expect(() => readEnvironment({ APP_ORIGIN })).toThrow(/APP_ORIGIN/);
  });

  it("requires HTTPS and PostgreSQL in production", () => {
    expect(() => readEnvironment({ DEPLOYMENT_ENV: "production" })).toThrow(
      /APP_ORIGIN.*DATABASE_URL/,
    );

    const DATABASE_URL = "postgresql://user:password@localhost:5432/coal";
    expect(
      readEnvironment({
        DEPLOYMENT_ENV: "production",
        APP_ORIGIN: "https://coal.example.test",
        DATABASE_URL,
        AUTH_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
        SMTP_URL: "smtps://relay.example.test",
        SMTP_FROM: "reset@coal.example.test",
      }),
    ).toMatchObject({ DEPLOYMENT_ENV: "production", DATABASE_URL });
  });

  it("omits invalid database credentials from error details", () => {
    const invalidConfig = () =>
      readEnvironment({
        DATABASE_URL: "mysql://user:private-token@localhost/coal",
      });
    expect(invalidConfig).toThrow(/DATABASE_URL/);
    expect(invalidConfig).not.toThrow(/private-token/);
  });
});

describe("application status", () => {
  it("reports liveness without cacheable details", async () => {
    const response = await health(new Request("http://127.0.0.1:3000/healthz"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports unready when there is no configured database", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    try {
      const response = await ready(new Request("http://127.0.0.1:3000/readyz"));
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ status: "not_ready" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
