"use client";

import Image from "next/image";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  documentDateFormats,
  documentNumberFormats,
} from "@/domain/document-format";
import type { BankCategory } from "@/generated/prisma/enums";
import { settings } from "@/i18n/messages/settings-en";
import { saveBank, saveCompany, type SettingsActionState } from "./actions";
import styles from "./settings.module.css";

export type CompanyValues = Record<
  | "name"
  | "tagline"
  | "address"
  | "phone"
  | "email"
  | "currencySymbol"
  | "weightUnit"
  | "dateFormat"
  | "numberFormat"
  | "footer"
  | "orderPrefix"
  | "voucherPrefix",
  string
>;

export type BankValues = {
  id: string;
  name: string;
  category: BankCategory;
  isActive: boolean;
  version: string;
};

function FormMessage({ state }: { state: SettingsActionState }) {
  if (!state) return null;
  const failed = state.kind === "error";
  return (
    <p
      className={failed ? styles.error : styles.success}
      role={failed ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

function submitSettingsForm(
  event: FormEvent<HTMLFormElement>,
  dispatch: (data: FormData) => void,
) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  // React's automatic form reset also resets controlled select and checkbox values.
  startTransition(() => dispatch(data));
}

export function CompanyForm({
  values,
  version,
  logoUrl,
}: {
  values: CompanyValues;
  version: string;
  logoUrl: string | null;
}) {
  const [draft, setDraft] = useState(values);
  const [savedValues, setSavedValues] = useState(values);
  const [draftVersion, setDraftVersion] = useState(version);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: SettingsActionState, data: FormData) => {
      const result = await saveCompany(previous, data);
      if (result?.kind === "success") {
        setSavedValues(draft);
        setDraftVersion(result.version);
        setSelectedLogo(null);
        setRemoveLogo(false);
        if (logoInput.current) logoInput.current.value = "";
      }
      return result;
    },
    null,
  );
  const dirty =
    Object.entries(draft).some(
      ([name, value]) => savedValues[name as keyof CompanyValues] !== value,
    ) ||
    selectedLogo !== null ||
    removeLogo;
  useUnsavedWarning(dirty && !pending);

  function propsFor(name: keyof CompanyValues) {
    return {
      name,
      value: draft[name],
      disabled: pending,
      "aria-invalid":
        (state?.kind === "error" && state.fields?.includes(name)) || undefined,
      onChange: (
        event: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => {
        const value = event.currentTarget.value;
        setDraft((current) => ({ ...current, [name]: value }));
      },
    };
  }

  return (
    <form
      className={styles.companyForm}
      method="post"
      onSubmit={(event) => submitSettingsForm(event, action)}
      aria-busy={pending}
    >
      <input type="hidden" name="version" value={draftVersion} readOnly />
      <section className={styles.panel} aria-labelledby="company-profile-title">
        <header className={styles.panelHeading}>
          <h2 id="company-profile-title">{settings.company}</h2>
          <p>{settings.companyHelp}</p>
        </header>
        <div className={styles.formGrid}>
          <Field label={settings.companyName}>
            <input
              {...propsFor("name")}
              required
              maxLength={160}
              autoComplete="organization"
            />
          </Field>
          <Field label={settings.tagline}>
            <input {...propsFor("tagline")} maxLength={250} />
          </Field>
          <div className={styles.fullWidth}>
            <Field label={settings.address}>
              <textarea
                {...propsFor("address")}
                rows={2}
                maxLength={500}
                autoComplete="street-address"
              />
            </Field>
          </div>
          <Field label={settings.phone}>
            <input
              {...propsFor("phone")}
              type="tel"
              maxLength={40}
              autoComplete="tel"
            />
          </Field>
          <Field label={settings.email}>
            <input
              {...propsFor("email")}
              type="email"
              maxLength={254}
              autoComplete="email"
            />
          </Field>
        </div>
        <div className={styles.logoRow}>
          {logoUrl && !removeLogo && (
            <Image
              alt={settings.currentLogo}
              src={logoUrl}
              width={72}
              height={72}
              className={styles.logoPreview}
              unoptimized
            />
          )}
          <div className={styles.logoControls}>
            <Field label={settings.logo}>
              <input
                ref={logoInput}
                type="file"
                name="logoFile"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="company-logo-help"
                aria-invalid={
                  (state?.kind === "error" && state.fields?.includes("logo")) ||
                  undefined
                }
                disabled={pending}
                onChange={(event) => {
                  setSelectedLogo(event.currentTarget.files?.item(0) ?? null);
                  setRemoveLogo(false);
                }}
              />
            </Field>
            <p className={styles.hint} id="company-logo-help">
              {settings.logoHelp}
            </p>
            {selectedLogo && <p className={styles.hint}>{selectedLogo.name}</p>}
            {logoUrl && (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  name="removeLogo"
                  value="yes"
                  checked={removeLogo}
                  disabled={selectedLogo !== null || pending}
                  onChange={(event) =>
                    setRemoveLogo(event.currentTarget.checked)
                  }
                />
                {settings.removeLogo}
              </label>
            )}
          </div>
        </div>
      </section>

      <section
        className={styles.panel}
        aria-labelledby="document-defaults-title"
      >
        <header className={styles.panelHeading}>
          <h2 id="document-defaults-title">{settings.documentSettings}</h2>
        </header>
        <div className={styles.formGrid}>
          <Field label={settings.currencySymbol}>
            <input {...propsFor("currencySymbol")} required maxLength={12} />
          </Field>
          <Field label={settings.weightUnit}>
            <select {...propsFor("weightUnit")}>
              {Object.entries(settings.weightUnits).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={settings.dateFormat}>
            <select {...propsFor("dateFormat")}>
              {documentDateFormats.map((format) => (
                <option key={format} value={format}>
                  {settings.dateFormatExamples[format]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={settings.numberFormat}>
            <select {...propsFor("numberFormat")}>
              {documentNumberFormats.map((format) => (
                <option key={format} value={format}>
                  {settings.numberFormatExamples[format]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={settings.orderPrefix}>
            <input
              {...propsFor("orderPrefix")}
              required
              maxLength={16}
              pattern="[a-zA-Z0-9]+"
              aria-describedby="number-prefix-help"
            />
          </Field>
          <Field label={settings.voucherPrefix}>
            <input
              {...propsFor("voucherPrefix")}
              required
              maxLength={16}
              pattern="[a-zA-Z0-9]+"
              aria-describedby="number-prefix-help"
            />
          </Field>
          <p
            className={`${styles.hint} ${styles.fullWidth}`}
            id="number-prefix-help"
          >
            {settings.prefixHelp}
          </p>
          <div className={styles.fullWidth}>
            <Field label={settings.footer}>
              <textarea {...propsFor("footer")} rows={2} maxLength={500} />
            </Field>
          </div>
        </div>
        <footer className={styles.formFooter}>
          <FormMessage
            state={dirty && state?.kind === "success" ? null : state}
          />
          {dirty && !pending && state?.kind !== "error" && (
            <p className={styles.hint}>{settings.unsaved}</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? settings.saving : settings.saveSettings}
          </Button>
        </footer>
      </section>
    </form>
  );
}

function BankForm({ bank }: { bank?: BankValues }) {
  const [name, setName] = useState(bank?.name ?? "");
  const [category, setCategory] = useState<string>(bank?.category ?? "BANK");
  const [draftVersion, setDraftVersion] = useState(bank?.version);
  const [savedName, setSavedName] = useState(name);
  const [savedCategory, setSavedCategory] = useState(category);
  const [state, action, pending] = useActionState(
    async (previous: SettingsActionState, data: FormData) => {
      const result = await saveBank(previous, data);
      if (result?.kind === "success") {
        setDraftVersion(result.version);
        setSavedName(bank ? name : "");
        setSavedCategory(category);
        if (!bank) setName("");
      }
      return result;
    },
    null,
  );
  useUnsavedWarning(
    (name !== savedName || category !== savedCategory) && !pending,
  );

  return (
    <form
      className={styles.bankForm}
      method="post"
      onSubmit={(event) => submitSettingsForm(event, action)}
      aria-busy={pending}
    >
      <input
        type="hidden"
        name="operation"
        value={bank ? "edit" : "create"}
        readOnly
      />
      {bank && (
        <>
          <input type="hidden" name="id" value={bank.id} readOnly />
          <input type="hidden" name="version" value={draftVersion} readOnly />
        </>
      )}
      <div className={styles.bankGrid}>
        <Field label={settings.bankName}>
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            aria-invalid={
              (state?.kind === "error" && state.fields?.includes("name")) ||
              undefined
            }
            disabled={pending}
            maxLength={80}
            required
          />
        </Field>
        <Field label={settings.bankCategory}>
          <select
            name="category"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
            aria-invalid={
              (state?.kind === "error" && state.fields?.includes("category")) ||
              undefined
            }
            disabled={pending}
          >
            {Object.entries(settings.category).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormMessage state={state} />
      <Button
        variant={bank ? "outline" : "default"}
        type="submit"
        disabled={pending}
      >
        {pending
          ? settings.saving
          : bank
            ? settings.saveAccount
            : settings.addAccount}
      </Button>
    </form>
  );
}

function BankStatusForm({ bank }: { bank: BankValues }) {
  const [state, action, pending] = useActionState(saveBank, null);
  const label = bank.isActive ? settings.deactivate : settings.reactivate;
  return (
    <form action={action} className={styles.bankStatusForm} aria-busy={pending}>
      <input type="hidden" name="operation" value="status" readOnly />
      <input type="hidden" name="id" value={bank.id} readOnly />
      <input type="hidden" name="version" value={bank.version} readOnly />
      <input
        type="hidden"
        name="isActive"
        value={bank.isActive ? "no" : "yes"}
        readOnly
      />
      <Button variant="outline" size="sm" type="submit" disabled={pending}>
        {pending ? settings.saving : label}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function BankSettings({ banks }: { banks: BankValues[] }) {
  return (
    <section
      className={styles.panel}
      id="payment-accounts"
      aria-labelledby="payment-accounts-title"
    >
      <header className={styles.panelHeading}>
        <h2 id="payment-accounts-title">{settings.banks}</h2>
        <p>{settings.bankHelp}</p>
      </header>
      {banks.length === 0 ? (
        <p className={styles.hint}>{settings.bankEmpty}</p>
      ) : (
        <ul className={styles.bankList}>
          {banks.map((bank) => (
            <li key={bank.id} className={styles.bankItem}>
              <div className={styles.bankLead}>
                <div className={styles.bankDetails}>
                  <strong>{bank.name}</strong>
                  <p className={styles.bankMeta}>
                    <span>{settings.category[bank.category]}</span>
                    <span
                      className={
                        bank.isActive ? styles.activeTag : styles.inactiveTag
                      }
                    >
                      {bank.isActive ? settings.active : settings.inactive}
                    </span>
                  </p>
                </div>
                <BankStatusForm bank={bank} />
              </div>
              <details className={styles.bankEdit}>
                <summary aria-label={settings.editNamedAccount(bank.name)}>
                  {settings.editAccount}
                </summary>
                <BankForm bank={bank} />
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.addBank}>
        <BankForm />
      </div>
    </section>
  );
}
