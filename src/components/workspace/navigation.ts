import {
  Building2,
  ChartNoAxesCombined,
  Files,
  LayoutDashboard,
  Settings,
  Truck,
  UsersRound,
  Wallet,
  ReceiptText,
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import { messages } from "@/i18n";
import type { Permission } from "@/domain/permissions";

export type Destination = {
  href: string;
  label: string;
};

type MenuItem =
  | (Destination & { icon: LucideIcon })
  | { label: string; icon: LucideIcon; children: Destination[] };

const { nav } = messages;

export const primaryMenu: MenuItem[] = [
  { href: "/", label: nav.dashboard, icon: LayoutDashboard },
  { href: "/orders", label: nav.orderEntry, icon: Truck },
  {
    label: nav.details,
    icon: Files,
    children: [
      { href: "/details/sales", label: nav.salesDetails },
      { href: "/details/customers", label: nav.customerDetails },
      { href: "/details/suppliers", label: nav.supplierDetails },
    ],
  },
  { href: "/account", label: nav.account, icon: Wallet },
  { href: "/expenses", label: nav.expenses, icon: ReceiptText },
  { href: "/deliveries", label: nav.deliveries, icon: PackageCheck },
  {
    label: nav.reports,
    icon: ChartNoAxesCombined,
    children: [
      { href: "/reports/sales", label: nav.salesReport },
      { href: "/reports/customers", label: nav.customersReport },
      { href: "/reports/customer", label: nav.singleCustomerReport },
      { href: "/reports/suppliers", label: nav.suppliersReport },
      { href: "/reports/supplier", label: nav.singleSupplierReport },
    ],
  },
  { href: "/customers", label: nav.customers, icon: UsersRound },
  { href: "/suppliers", label: nav.suppliers, icon: Building2 },
];

export const settingsItem = {
  href: "/settings",
  label: nav.settings,
  icon: Settings,
};

export const destinations = [...primaryMenu, settingsItem].flatMap<Destination>(
  (item) => ("children" in item ? item.children : [item]),
);

export function permissionForDestination(href: string): Permission {
  if (href.startsWith("/details/")) return "details.view";
  if (href.startsWith("/reports/")) return "reports.view";
  switch (href) {
    case "/":
      return "dashboard.view";
    case "/orders":
      return "orders.create";
    case "/account":
      return "account.view";
    case "/expenses":
      return "expenses.view";
    case "/deliveries":
      return "deliveries.view";
    case "/customers":
    case "/suppliers":
      return "parties.view";
    default:
      return "settings.manage";
  }
}
