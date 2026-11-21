import { PartySummaryView } from "../party-summary-view";

export default async function SuppliersReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PartySummaryView kind="supplier" query={await searchParams} />;
}
