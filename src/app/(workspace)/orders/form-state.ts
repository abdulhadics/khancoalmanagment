import type { OrderErrorCode } from "@/i18n/messages/orders-en";

export type OrderIssue = { row?: number; field?: string; code: OrderErrorCode };

export type BatchState = {
  issues?: OrderIssue[];
  saved?: { count: number; key: string; businessDate: string };
};

export type EditState = { issue?: OrderIssue };

export type EditMode = "pending" | "metadata" | "price" | "correct" | "void";
