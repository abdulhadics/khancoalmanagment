import { defineConfig } from "@playwright/test";
import "./tests/integration/setup";

const port = Number(process.env.PLAYWRIGHT_APP_PORT ?? "3147");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PLAYWRIGHT_APP_PORT must be an integer from 1024 to 65535.");
}
const origin = `http://127.0.0.1:${port}`;

const browserName = process.env.PLAYWRIGHT_BROWSER ?? "chromium";
if (
  browserName !== "chromium" &&
  browserName !== "firefox" &&
  browserName !== "webkit"
) {
  throw new Error("PLAYWRIGHT_BROWSER must be chromium, firefox, or webkit.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 60_000,
  globalTimeout: 420_000,
  use: {
    baseURL: origin,
    browserName,
    channel:
      browserName === "chromium"
        ? (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "msedge")
        : undefined,
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/healthz`,
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: origin,
      APP_PORT: String(port),
      DEPLOYMENT_ENV: "development",
      DATABASE_URL: process.env.INTEGRATION_DATABASE_URL!,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
