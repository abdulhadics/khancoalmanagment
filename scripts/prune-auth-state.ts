import { pruneExpiredAuthState } from "../src/server/auth/maintenance";
import { getDatabase } from "../src/server/db/client";

try {
  const database = getDatabase();
  try {
    console.log(JSON.stringify(await pruneExpiredAuthState(database)));
  } finally {
    await database.$disconnect();
  }
} catch {
  console.error(
    "Could not clean expired sign-in records. Check deployment configuration and database availability.",
  );
  process.exitCode = 1;
}
