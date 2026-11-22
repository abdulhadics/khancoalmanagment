"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { salesDetailsMessages as details } from "@/i18n/messages/sales-details-en";
import { salesPartyFilter as t } from "@/i18n/messages/sales-party-filter-en";
import type {
  SalesPartyCatalog,
  SalesPartyKind,
  SalesPartyOption,
  SalesPartySearchResult,
} from "@/server/reporting/sales-party-options";

type Props = {
  kind: SalesPartyKind;
  catalog: SalesPartyCatalog;
  className: string;
};

const allParties = {
  customer: details.allCustomers,
  supplier: details.allSuppliers,
};

export function SalesPartyFilter({ kind, catalog, className }: Props) {
  if (catalog.searchable) {
    return (
      <SearchableSalesPartyFilter
        key={catalog.selected?.id ?? "none"}
        kind={kind}
        initial={catalog.selected}
        className={className}
      />
    );
  }
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {details.columns[kind]}
      <select
        name={`${kind}Id`}
        defaultValue={catalog.selected?.id ?? ""}
        className={className}
      >
        <option value="">{allParties[kind]}</option>
        {catalog.options.map(({ id, name, code }) => (
          <option key={id} value={id}>
            {name} · {code}
          </option>
        ))}
      </select>
    </label>
  );
}

type Lookup = SalesPartySearchResult | "error";

function SearchableSalesPartyFilter({
  kind,
  initial,
  className,
}: {
  kind: SalesPartyKind;
  initial: SalesPartyOption | null;
  className: string;
}) {
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [lookup, setLookup] = useState<{
    query: string;
    result: Lookup;
  } | null>(null);
  const result = lookup?.query === query ? lookup.result : null;
  const all = allParties[kind];
  const labels = t[kind];

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const delay = window.setTimeout(
      async () => {
        try {
          const params = new URLSearchParams({ kind, q: query.trim() });
          const response = await fetch(`/reports/party-options?${params}`, {
            signal: abort.signal,
          });
          if (!response.ok) throw new Error("Lookup failed.");
          const result: SalesPartySearchResult = await response.json();
          if (!abort.signal.aborted) setLookup({ query, result });
        } catch {
          if (!abort.signal.aborted) setLookup({ query, result: "error" });
        }
      },
      query ? 180 : 0,
    );
    return () => {
      window.clearTimeout(delay);
      abort.abort();
    };
  }, [kind, open, query, retry]);

  function choose(party: SalesPartyOption | null) {
    setSelected(party);
    dialog.current?.close();
  }

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span id={`${id}-label`}>{details.columns[kind]}</span>
      <input type="hidden" name={`${kind}Id`} value={selected?.id ?? ""} />
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label ${id}-selection`}
        className={`${className} flex items-center justify-between gap-2 text-start`}
        onClick={() => {
          setLookup(null);
          setQuery("");
          setOpen(true);
          dialog.current?.showModal();
          searchField.current?.focus();
        }}
      >
        <span id={`${id}-selection`} className="truncate">
          {selected ? `${selected.name} · ${selected.code}` : all}
        </span>
        <ChevronDown
          aria-hidden="true"
          size={16}
          className="shrink-0 text-muted-foreground"
        />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          opener.current?.focus();
        }}
        className="fixed inset-0 m-auto max-h-[92dvh] w-[min(94vw,30rem)] overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-4 text-foreground backdrop:bg-slate-950/50 sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            {labels.choose}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => dialog.current?.close()}
          >
            {t.close}
          </Button>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">
          {labels.search}
          <span className="relative block">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-3 text-muted-foreground"
            />
            <input
              ref={searchField}
              type="search"
              maxLength={120}
              value={query}
              className={`${className} w-full ps-9`}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </span>
        </label>
        <button
          type="button"
          className="mt-3 rounded-md px-2 py-2 text-sm text-primary hover:bg-muted"
          onClick={() => choose(null)}
        >
          {all}
        </button>
        {result === "error" ? (
          <div className="mt-2 grid justify-items-start gap-2">
            <p role="alert" className="text-sm text-negative">
              {t.error}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setLookup(null);
                setRetry((prior) => prior + 1);
              }}
            >
              {t.retry}
            </Button>
          </div>
        ) : (
          <>
            {result?.options.length ? (
              <ul className="mt-2 max-h-[min(42dvh,20rem)] overflow-y-auto rounded-md border border-border">
                {result.options.map((party) => (
                  <li
                    key={party.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <button
                      type="button"
                      className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-start text-sm hover:bg-muted focus-visible:bg-muted"
                      onClick={() => choose(party)}
                    >
                      <span className="min-w-0 break-words font-medium">
                        {party.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {party.code}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {!result
                ? t.searching
                : result.options.length === 0
                  ? t.empty
                  : result.hasMore
                    ? t.more
                    : t.matches(result.options.length)}
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}
