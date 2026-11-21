import { PartyLedgerView } from "../../details/party-ledger-view";

export default async function SingleSupplierReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <PartyLedgerView kind="supplier" query={await searchParams} mode="report" />
  );
}
