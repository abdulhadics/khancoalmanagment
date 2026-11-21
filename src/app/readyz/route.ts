import { isDatabaseReady } from "@/server/db/readiness";

export async function GET() {
  const ready = await isDatabaseReady();
  return Response.json(
    { status: ready ? "ready" : "not_ready" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
