import { execSync } from "node:child_process";

if (process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL) {
  try {
    console.log("Applying database migrations...");
    execSync("npx prisma migrate deploy", { stdio: "inherit" });
  } catch (error) {
    console.error("Database migration warning:", error instanceof Error ? error.message : String(error));
  }
}

execSync("next build", { stdio: "inherit" });
