import {
  InvalidEnvironmentConfiguration,
  readEnvironment,
} from "../config/env";
import { getDatabase } from "./client";

export async function checkDatabaseReadiness() {
  try {
    if (!readEnvironment().DATABASE_URL) {
      return { ready: false as const, reason: "database_url_missing" };
    }
    const results = await getDatabase().$queryRaw<{ ready: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM public.roles) AS ready
    `;
    return results[0]?.ready === true
      ? { ready: true as const }
      : { ready: false as const, reason: "role_catalog_empty" };
  } catch (error) {
    return error instanceof InvalidEnvironmentConfiguration
      ? {
          ready: false as const,
          reason: "configuration_invalid",
          fields: error.fields,
        }
      : { ready: false as const, reason: "database_query_failed" };
  }
}

export async function isDatabaseReady() {
  return (await checkDatabaseReadiness()).ready;
}
