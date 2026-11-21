import { Decimal } from "decimal.js";

const standardGrouping = new Intl.NumberFormat("en-PK");
const southAsianGrouping = new Intl.NumberFormat("en-IN");

export function formatDecimal(
  value: string | bigint,
  scale: 0 | 2 | 3,
  numberFormat = "en-PK",
): string {
  const rounded = new Decimal(value.toString()).toFixed(
    scale,
    Decimal.ROUND_HALF_UP,
  );
  const negative = rounded.startsWith("-");
  const [whole, fraction] = (negative ? rounded.slice(1) : rounded).split(".");
  const grouping =
    numberFormat === "en-IN" ? southAsianGrouping : standardGrouping;
  const grouped = grouping.format(BigInt(whole));
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function formatCurrency(
  value: string,
  preferences = { currencySymbol: "Rs.", numberFormat: "en-PK" },
): string {
  return `${preferences.currencySymbol}\u00a0${formatDecimal(value, 2, preferences.numberFormat)}`;
}
