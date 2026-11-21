import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/permissions";
import { messages } from "@/i18n";
import { auth } from "@/i18n/messages/auth-en";
import { settings } from "@/i18n/messages/settings-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { readCompanySettings } from "@/server/settings/company";
import { BankSettings, CompanyForm } from "./settings-forms";
import styles from "./settings.module.css";

export default async function SettingsPage() {
  const actor = await requireActor();
  if (!can(actor.roleCode, "settings.manage")) notFound();
  const { company, banks } = await readCompanySettings(getDatabase(), actor);
  const { documentProfile: profile } = company;
  const logoUrl =
    profile.logoBytes && profile.logoMediaType
      ? `data:${profile.logoMediaType};base64,${Buffer.from(profile.logoBytes).toString("base64")}`
      : null;

  return (
    <>
      <div className={`page-heading ${styles.heading}`}>
        <div>
          <h1>{messages.nav.settings}</h1>
          <p>{settings.description}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/settings/users">{auth.manageStaff}</Link>
        </Button>
      </div>

      <div className={styles.layout}>
        <CompanyForm
          version={company.updatedAt.toISOString()}
          values={{
            name: profile.name,
            tagline: profile.tagline ?? "",
            address: profile.address ?? "",
            phone: profile.phone ?? "",
            email: profile.email ?? "",
            currencySymbol: profile.currencySymbol,
            weightUnit: profile.weightUnit,
            dateFormat: profile.dateFormat,
            numberFormat: profile.numberFormat,
            footer: profile.footer ?? "",
            orderPrefix: company.orderPrefix,
            voucherPrefix: company.voucherPrefix,
          }}
          logoUrl={logoUrl}
        />
        <BankSettings
          banks={banks.map((bank) => ({
            id: bank.id,
            name: bank.name,
            category: bank.category,
            isActive: bank.isActive,
            version: bank.updatedAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
