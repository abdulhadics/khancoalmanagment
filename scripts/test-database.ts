import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

const { Client } = pg;

function readTestAdminUrl() {
  try {
    const url = new URL(process.env.TEST_ADMIN_DATABASE_URL ?? "");
    if (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      url.pathname === "/postgres"
    ) {
      return url;
    }
  } catch {
    // Report the required shape without including the supplied value.
  }

  throw new Error(
    "Set TEST_ADMIN_DATABASE_URL to the postgres maintenance database on the local test server.",
  );
}

function runNpm(
  script: string,
  environment: NodeJS.ProcessEnv,
  scriptArguments: string[] = [],
) {
  const npm = process.env.npm_execpath;
  if (!npm) {
    throw new Error(
      "Run the database harness through npm run test:integration.",
    );
  }

  const forwarded = scriptArguments.length ? ["--", ...scriptArguments] : [];
  const child = spawnSync(
    process.execPath,
    [npm, "run", script, ...forwarded],
    {
      env: environment,
      stdio: "inherit",
    },
  );
  if (child.error || child.status !== 0) {
    throw new Error(`The ${script} command failed.`);
  }
}

async function testAgainstFreshDatabase() {
  const adminUrl = readTestAdminUrl();
  // This identifier has a fixed prefix and a random hexadecimal suffix.
  const databaseName = `khancoal_${randomBytes(8).toString("hex")}_test`;
  const admin = new Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 3_000,
  });
  let created = false;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
    created = true;

    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    const environment = {
      ...process.env,
      DEPLOYMENT_ENV: "development",
      DATABASE_URL: testUrl.toString(),
      MIGRATION_DATABASE_URL: testUrl.toString(),
      INTEGRATION_DATABASE_URL: testUrl.toString(),
    };

    runNpm("db:migrate", environment);
    runNpm(
      "test:integration:prepared",
      environment,
      process.env.RUN_INTEGRATION_COVERAGE === "1" ? ["--coverage"] : [],
    );
    if (process.env.RUN_BROWSER_TESTS === "1") {
      runNpm("test:e2e:prepared", environment);
    }
  } finally {
    try {
      if (created) {
        await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
    }
  }
}

testAgainstFreshDatabase().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Database integration checks failed.",
  );
  process.exitCode = 1;
});
