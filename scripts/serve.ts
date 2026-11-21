import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

import nextEnvironment from "@next/env";

import { readEnvironment } from "../src/server/config/env";

function serve() {
  const [mode, ...args] = process.argv.slice(2);
  if ((mode !== "dev" && mode !== "start") || args.length !== 0) {
    throw new Error(
      "Usage is npm run dev or npm start. Set APP_PORT to select the port.",
    );
  }

  const projectRoot = process.cwd();
  nextEnvironment.loadEnvConfig(projectRoot, mode === "dev");
  const config = readEnvironment();

  if (mode === "dev" && config.DEPLOYMENT_ENV === "production") {
    throw new Error("Start a production deployment with npm start.");
  }

  const projectRequire = createRequire(join(projectRoot, "package.json"));
  const nextCli = projectRequire.resolve("next/dist/bin/next");
  const child = spawn(
    process.execPath,
    [
      nextCli,
      mode,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(config.APP_PORT),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: mode === "dev" ? "development" : "production",
      },
    },
  );

  child.on("error", (error) => {
    console.error(`Unable to start Next.js. ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}

try {
  serve();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unable to start the application.",
  );
  process.exitCode = 1;
}
