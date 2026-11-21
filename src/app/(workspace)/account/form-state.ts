import type { PaymentErrorCode } from "@/i18n/messages/account-en";

export type PaymentFormState = {
  issue?: {
    code: PaymentErrorCode;
    field?: string;
    outstanding?: string;
    excess?: string;
  };
  saved?: { id: string; key: string; date: string };
  updated?: boolean;
};
