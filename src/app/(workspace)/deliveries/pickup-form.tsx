"use client";

import { useRef, useState, useTransition } from "react";
import { Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deliveries as t } from "@/i18n/messages/deliveries-en";
import { recordPickupAction, completeDeliveryAction } from "./actions";

export function PickupForm({
  deliveryRecordId,
  customerName,
  remainingWeight,
  today,
}: {
  deliveryRecordId: string;
  customerName: string;
  remainingWeight: string;
  today: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCompleting, startCompleteTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handlePickup = (formData: FormData) => {
    startTransition(async () => {
      const result = await recordPickupAction({}, formData);
      if (result.success) {
        setIsOpen(false);
        setError(null);
        formRef.current?.reset();
      } else {
        setError(result.error ?? "save");
      }
    });
  };

  const handleComplete = () => {
    startCompleteTransition(async () => {
      const formData = new FormData();
      formData.set("deliveryRecordId", deliveryRecordId);
      formData.set("notes", "Marked complete manually by user");
      const result = await completeDeliveryAction({}, formData);
      if (result.success) {
        setIsOpen(false);
        setError(null);
      } else {
        setError(result.error ?? "save");
      }
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
        className="flex items-center gap-1.5"
      >
        <Truck size={14} />
        <span>{t.logPickup}</span>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-lg font-semibold">{t.logPickup}</h2>
                <p className="text-xs text-muted-foreground">
                  Customer: <strong>{customerName}</strong> | Remaining:{" "}
                  <strong>{remainingWeight} TON</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={20} />
              </button>
            </div>

            <form ref={formRef} action={handlePickup} className="space-y-4">
              <input type="hidden" name="deliveryRecordId" value={deliveryRecordId} />

              {error && (
                <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600">
                  {t.errors[error as keyof typeof t.errors] ?? t.errors.save}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="businessDate" className="block text-sm font-medium">
                    {t.pickupDate}
                  </label>
                  <input
                    id="businessDate"
                    name="businessDate"
                    type="date"
                    required
                    defaultValue={today}
                    className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="weight" className="block text-sm font-medium">
                    {t.deliveredWeight} (TON)
                  </label>
                  <input
                    id="weight"
                    name="weight"
                    type="text"
                    required
                    placeholder={`Max ${remainingWeight}`}
                    className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="vehicleNo" className="block text-sm font-medium">
                  {t.vehicleNo}
                </label>
                <input
                  id="vehicleNo"
                  name="vehicleNo"
                  type="text"
                  placeholder="e.g. TLX-492"
                  className="min-h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="notes" className="block text-sm font-medium">
                  {t.notes}
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="Driver info, bilty, or dispatch remarks"
                  className="w-full rounded-lg border border-border bg-card p-3 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isCompleting || isPending}
                  onClick={handleComplete}
                  className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  {isCompleting ? "Completing…" : t.complete}
                </Button>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending || isCompleting}>
                    {isPending ? t.saving : t.savePickup}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
