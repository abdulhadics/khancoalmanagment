import { Decimal } from "decimal.js";

// This constructor keeps monetary precision independent of other modules.
const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

const moneyLimit = new ExactDecimal("1000000000000");
const weightLimit = new ExactDecimal("1000000000");
const rateLimit = new ExactDecimal("10000000000");
const decimalText = /^-?\d+(?:\.\d+)?$/;

function parseDecimal(
  input: string,
  scale: number,
  limit: Decimal,
  field: string,
): Decimal {
  if (input.length > 64 || input !== input.trim() || !decimalText.test(input)) {
    throw new RangeError(`${field} must be a decimal string.`);
  }
  const [, fraction = ""] = input.split(".");
  if (fraction.length > scale) {
    throw new RangeError(`${field} accepts at most ${scale} decimal places.`);
  }
  const decimal = new ExactDecimal(input);
  if (decimal.abs().gte(limit)) {
    throw new RangeError(`${field} is outside the supported range.`);
  }
  return decimal;
}

export function parseMoney(input: string): Decimal {
  return parseDecimal(input, 2, moneyLimit, "Money");
}

export function parseWeight(input: string): Decimal {
  const value = parseDecimal(input, 3, weightLimit, "Weight");
  if (value.lte(0)) throw new RangeError("Weight must be positive.");
  return value;
}

export function parseRate(input: string): Decimal {
  const value = parseDecimal(input, 2, rateLimit, "Rate");
  if (value.lt(0)) throw new RangeError("Rate must be non-negative.");
  return value;
}

interface OrderAmountInputs {
  weight: string;
  purchaseRate: string;
  sellRate: string;
}

function orderAmount(weight: Decimal, rate: Decimal, field: string): Decimal {
  const amount = weight.times(rate).toDecimalPlaces(2);
  if (amount.gte(moneyLimit)) {
    throw new RangeError(`${field} is outside the supported range.`);
  }
  return amount;
}

export function calculateOrderAmounts({
  weight,
  purchaseRate,
  sellRate,
}: OrderAmountInputs) {
  const load = parseWeight(weight);
  const buyAmount = orderAmount(load, parseRate(purchaseRate), "Buy amount");
  const sellAmount = orderAmount(load, parseRate(sellRate), "Sell amount");

  return {
    buyAmount: buyAmount.toFixed(2),
    sellAmount: sellAmount.toFixed(2),
    profit: sellAmount.minus(buyAmount).toFixed(2),
  };
}
