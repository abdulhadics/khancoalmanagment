import { getDatabase } from "./client";

export async function isDatabaseReady(): Promise<boolean> {
  try {
    const results = await getDatabase().$queryRaw<{ ready: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM public.roles) AS ready
    `;
    return results[0]?.ready === true;
  } catch {
    return false;
  }
}
