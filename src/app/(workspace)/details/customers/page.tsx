import { PartyLedgerView } from "../party-ledger-view";

export default async function CustomerDetails({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PartyLedgerView kind="customer" query={await searchParams} />;
}
