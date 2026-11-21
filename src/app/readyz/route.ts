export function GET() {
  return Response.json(
    { status: "not_ready" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
