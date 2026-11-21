import { defineConfig } from "@playwright/test";
import "./tests/integration/setup";

const origin = "http://127.0.0.1:3147";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 60_000,
  globalTimeout: 420_000,
  use: {
    baseURL: origin,
    channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "msedge",
  },
  webServer: {
    command: "npm run start",
    url: `${origin}/healthz`,
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: origin,
      APP_PORT: "3147",
      DEPLOYMENT_ENV: "development",
      DATABASE_URL: process.env.INTEGRATION_DATABASE_URL!,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
