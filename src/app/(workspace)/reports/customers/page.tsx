import { PartySummaryView } from "../party-summary-view";

export default async function CustomersReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PartySummaryView kind="customer" query={await searchParams} />;
}
