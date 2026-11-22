import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

export function makePrisma(
  databaseUrl: string,
  { connectionTimeoutMillis = 3_000 } = {},
): PrismaClient {
  const connection = new URL(databaseUrl);
  const options =
    connection.searchParams.get("options") ?? process.env.PGOPTIONS ?? "";
  // Prisma's PostgreSQL adapter encodes and reads timestamps as UTC clock values.
  connection.searchParams.set("options", `${options} -c timezone=UTC`.trim());
  const adapter = new PrismaPg({
    connectionString: connection.toString(),
    connectionTimeoutMillis,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}
