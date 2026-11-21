export type OrderMutationErrorCode =
  | "invalid"
  | "missing"
  | "stale"
  | "duplicateBilty"
  | "duplicateVehicle"
  | "creditLimit"
  | "integrity";

export class OrderMutationError extends Error {
  constructor(
    readonly code: OrderMutationErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = "OrderMutationError";
  }
}
