import { PartyLedgerView } from "../party-ledger-view";

export default async function SupplierDetails({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PartyLedgerView kind="supplier" query={await searchParams} />;
}
