import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      include: ["src/domain/**/*.ts", "src/server/**/*.ts"],
      reportsDirectory: "coverage/unit",
      reporter: ["text-summary", "json"],
    },
  },
});
