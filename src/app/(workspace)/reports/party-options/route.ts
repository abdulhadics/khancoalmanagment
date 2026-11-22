import { can } from "@/domain/permissions";
import { getCurrentActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import {
  parseSalesPartySearch,
  searchSalesPartyCatalog,
} from "@/server/reporting/sales-party-options";

export async function GET(request: Request) {
  const actor = await getCurrentActor();
  if (!actor || !can(actor.roleCode, "reports.view"))
    return new Response(null, { status: 404 });

  const search = parseSalesPartySearch(new URL(request.url).searchParams);
  if (!search) return new Response(null, { status: 400 });

  return Response.json(
    await searchSalesPartyCatalog(getDatabase(), actor, search),
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
