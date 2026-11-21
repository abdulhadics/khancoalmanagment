import { z } from "zod";
import {
  calculateOrderAmounts,
  parseRate,
  parseWeight,
} from "../../domain/money";

export type OrderCreateIssueCode =
  | "invalid"
  | "required"
  | "missingOrInactive"
  | "mineRequired"
  | "duplicateVehicle"
  | "duplicateBilty"
  | "creditLimit"
  | "pricingForbidden"
  | "closed"
  | "dateScope";

export type OrderCreateIssue = {
  row?: number;
  field: string;
  code: OrderCreateIssueCode;
};

export class DispatchInputError extends Error {
  constructor(
    public readonly field: string,
    public readonly code: OrderCreateIssueCode,
  ) {
    super(code);
    this.name = "DispatchInputError";
  }
}

const decimalString = z.string().trim().min(1).max(64);

export const dispatchRowSchema = z.strictObject({
  customerId: z.uuid(),
  supplierId: z.uuid(),
  mineId: z.union([z.uuid(), z.literal("")]).nullish(),
  vehicleNo: z.string().trim().min(1).max(40),
  weight: decimalString,
  sellRate: decimalString,
  purchaseRate: decimalString.nullish(),
  biltyNo: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1500).nullish(),
  confirmDuplicateVehicle: z.boolean().default(false),
  confirmCreditLimit: z.boolean().default(false),
});

export function normalizeVehicleNo(value: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, "-");
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N}-]{0,39}$/u.test(normalized) ||
    normalized.endsWith("-")
  ) {
    throw new DispatchInputError("vehicleNo", "invalid");
  }
  return normalized;
}

export function duplicateVehicleKey(value: string) {
  return value.replaceAll("-", "");
}

export function normalizeBiltyNo(value: string | null | undefined) {
  const normalized = value
    ?.normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, " ");
  if (normalized && normalized.length > 80)
    throw new DispatchInputError("biltyNo", "invalid");
  return normalized || null;
}

function decimalField(field: string, parse: () => string) {
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new DispatchInputError(field, "invalid");
  }
}

export function prepareDispatchRow(
  input: z.infer<typeof dispatchRowSchema>,
  { priced }: { priced: boolean },
) {
  const vehicleNo = normalizeVehicleNo(input.vehicleNo);
  const biltyNo = normalizeBiltyNo(input.biltyNo);
  const weight = decimalField("weight", () =>
    parseWeight(input.weight).toFixed(3),
  );
  const sellRate = decimalField("sellRate", () =>
    parseRate(input.sellRate).toFixed(2),
  );
  let purchaseRate: string | null = null;
  let amounts: {
    buyAmount: string | null;
    sellAmount: string | null;
    profit: string | null;
  } = {
    buyAmount: null,
    sellAmount: null,
    profit: null,
  };

  if (priced) {
    const suppliedRate = input.purchaseRate;
    if (suppliedRate == null)
      throw new DispatchInputError("purchaseRate", "required");
    purchaseRate = decimalField("purchaseRate", () =>
      parseRate(suppliedRate).toFixed(2),
    );
    try {
      amounts = calculateOrderAmounts({ weight, purchaseRate, sellRate });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new DispatchInputError(
        error.message.startsWith("Buy") ? "purchaseRate" : "sellRate",
        "invalid",
      );
    }
  } else if (input.purchaseRate != null) {
    throw new DispatchInputError("purchaseRate", "pricingForbidden");
  }

  return {
    customerId: input.customerId,
    supplierId: input.supplierId,
    mineId: input.mineId || null,
    vehicleNo,
    biltyNo,
    notes: input.notes || null,
    weight,
    sellRate,
    purchaseRate,
    ...amounts,
    confirmDuplicateVehicle: input.confirmDuplicateVehicle,
    confirmCreditLimit: input.confirmCreditLimit,
  };
}

export type PreparedDispatchRow = ReturnType<typeof prepareDispatchRow>;
