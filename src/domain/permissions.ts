import type { OrderStatus, RoleCode } from "@/generated/prisma/enums";

const allRoles = ["OWNER", "ACCOUNTANT", "OPERATOR", "VIEWER"] as const;
const owners = ["OWNER"] as const;
const accountants = ["OWNER", "ACCOUNTANT"] as const;
const dispatchers = ["OWNER", "ACCOUNTANT", "OPERATOR"] as const;
const reportReaders = ["OWNER", "ACCOUNTANT", "VIEWER"] as const;

const policy = {
  "profile.manage": allRoles,
  "dashboard.view": allRoles,
  "dashboard.financial": reportReaders,
  "parties.view": dispatchers,
  "parties.manage": accountants,
  "parties.openingBalance": owners,
  "orders.view": dispatchers,
  "orders.create": dispatchers,
  "orders.editPending": dispatchers,
  "orders.editMetadata": dispatchers,
  "orders.post": accountants,
  "orders.print": dispatchers,
  "orders.void": owners,
  "orders.financial": accountants,
  "details.view": accountants,
  "account.view": accountants,
  "account.manage": accountants,
  "account.void": owners,
  "reports.view": reportReaders,
  "reports.export": accountants,
  "settings.manage": owners,
  "staff.manage": owners,
  "admin.audit": owners,
  "admin.integrity": owners,
  "admin.periods": owners,
  "admin.backups": owners,
} as const satisfies Record<string, readonly RoleCode[]>;

export type Permission = keyof typeof policy;

export type PermissionActor = {
  roleCode: RoleCode;
  userId: string;
};

export class PermissionDenied extends Error {
  constructor() {
    super("Permission denied.");
    this.name = "PermissionDenied";
  }
}

export function can(role: string, action: string): boolean {
  if (!Object.hasOwn(policy, action)) return false;
  const roles: readonly string[] = policy[action as Permission];
  return roles.includes(role);
}

export function requirePermission(actor: PermissionActor, action: Permission) {
  if (!can(actor.roleCode, action)) throw new PermissionDenied();
}

type OrderScope = {
  createdById: string;
  businessDate: string;
  status: OrderStatus;
};

type OrderRecordPermission = Extract<
  Permission,
  | "orders.view"
  | "orders.editPending"
  | "orders.editMetadata"
  | "orders.post"
  | "orders.print"
  | "orders.void"
>;

export function canAccessOrder(
  actor: PermissionActor,
  action: OrderRecordPermission,
  order: OrderScope,
  today: string,
): boolean {
  if (!can(actor.roleCode, action)) return false;
  if (action === "orders.editPending" && order.status !== "PENDING_PRICING") {
    return false;
  }
  if (action === "orders.editMetadata" && order.status !== "POSTED")
    return false;
  if (actor.roleCode !== "OPERATOR") return true;

  return order.createdById === actor.userId && order.businessDate === today;
}

export function canCreateOrder(
  actor: PermissionActor,
  businessDate: string,
  today: string,
  source?: OrderScope,
): boolean {
  if (!can(actor.roleCode, "orders.create")) return false;
  if (actor.roleCode === "OPERATOR" && businessDate !== today) return false;
  return (
    source === undefined || canAccessOrder(actor, "orders.view", source, today)
  );
}
