import { PartyLedgerView } from "../../details/party-ledger-view";

export default async function SingleCustomerReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <PartyLedgerView kind="customer" query={await searchParams} mode="report" />
  );
}
