import { readEnvironment } from "../config/env";
import { makePrisma } from "./connect";

type DatabaseClient = ReturnType<typeof makePrisma>;

const registry = globalThis as typeof globalThis & {
  khancoalDatabase?: DatabaseClient;
};

export function getDatabase(): DatabaseClient {
  const { DATABASE_URL } = readEnvironment();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }

  registry.khancoalDatabase ??= makePrisma(DATABASE_URL);
  return registry.khancoalDatabase;
}
