import nextEnvironment from "@next/env";

import {
  OwnerBootstrapError,
  readOwnerBootstrapInput,
  seedFirstOwner,
} from "../src/server/auth/seed-first-owner";
import { readEnvironment } from "../src/server/config/env";
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

  const database = makePrisma(DATABASE_URL);
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

try {
  await run();
} catch (error) {
  console.error(
    error instanceof OwnerBootstrapError
      ? error.message
      : "Owner setup failed. Check the database connection and apply migrations before retrying.",
  );
  process.exitCode = 1;
}
