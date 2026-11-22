import nextEnvironment from "@next/env";
import { Prisma } from "../src/generated/prisma/client";

import {
  OwnerBootstrapError,
  readOwnerBootstrapInput,
  seedFirstOwner,
} from "../src/server/auth/seed-first-owner";
import {
  InvalidEnvironmentConfiguration,
  readEnvironment,
} from "../src/server/config/env";
import { makePrisma } from "../src/server/db/connect";

async function run() {
  // Capture the Owner bootstrap values before loading application DB settings.
  const input = readOwnerBootstrapInput(process.env);
  delete process.env.OWNER_PASSWORD;
  nextEnvironment.loadEnvConfig(process.cwd());
  const { DATABASE_URL } = readEnvironment({
    DATABASE_URL: process.env.DATABASE_URL,
  });
  if (!DATABASE_URL) throw new OwnerBootstrapError("Set DATABASE_URL first.");

  const database = makePrisma(DATABASE_URL, {
    connectionTimeoutMillis: 15_000,
  });
  try {
    const result = await seedFirstOwner(database, input);
    console.log(
      result === "created"
        ? "First Owner created. A password change is required on first sign-in."
        : "The first Owner already exists. No changes were made.",
    );
  } finally {
    await database.$disconnect();
  }
}

function describeFailure(error: unknown) {
  if (error instanceof OwnerBootstrapError) return error.message;
  if (error instanceof InvalidEnvironmentConfiguration) {
    return "Set DATABASE_URL to a valid PostgreSQL connection string.";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const detail = {
      P1000:
        "The database rejected the credentials. Use the current direct connection URL.",
      P1001:
        "The database could not be reached. Check the direct connection URL and network.",
      P1008:
        "The database connection timed out. Check the connection and retry.",
      P1010:
        "The database login lacks access. Use the schema owner's direct connection URL for setup.",
      P1011:
        "The database TLS connection failed. Check the provider's secure connection URL.",
      P2021:
        "The expected table is missing. Check that migrations were applied to this database.",
      P2028:
        "The database transaction could not finish. Retry using the direct connection URL.",
    } as Readonly<Record<string, string>>;
    const sqlState = error.meta?.code;
    const tag =
      typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState)
        ? `${error.code}/${sqlState}`
        : error.code;
    return `Owner setup failed (${tag}). ${detail[error.code] ?? "Check the connection and database permissions."}`;
  }
  return "Owner setup failed. Check the database connection and apply migrations before retrying.";
}

try {
  await run();
} catch (error) {
  console.error(describeFailure(error));
  process.exitCode = 1;
}
