import Link from "next/link";
import { account } from "@/i18n/messages/account-en";
import { orders } from "@/i18n/messages/orders-en";

export function PartyActions({
  kind,
  id,
  active,
}: {
  kind: "customer" | "supplier";
  id: string;
  active: boolean;
}) {
  const customer = kind === "customer";
  const segment = customer ? "customers" : "suppliers";
  const payment = customer ? "receive" : "pay";
  const form = customer ? "customer-receipt" : "supplier-payment";
  return (
    <>
      <Link
        className="hover:underline"
        href={`/details/${segment}?partyId=${id}`}
      >
        {account.ledger}
      </Link>
      {active && (
        <>
          <Link
            className="hover:underline"
            href={`/account?${payment}=${id}#${form}`}
          >
            {customer ? account.receive : account.pay}
          </Link>
          <Link
            className="whitespace-nowrap hover:underline"
            href={`/orders?${kind}Id=${id}`}
          >
            {orders.newOrder}
          </Link>
        </>
      )}
    </>
  );
}
