import {
  Building2,
  ChartNoAxesCombined,
  Files,
  LayoutDashboard,
  Settings,
  Truck,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { messages } from "@/i18n";

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
