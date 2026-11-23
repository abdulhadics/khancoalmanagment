import { ArrowLeft, Truck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { todayBusinessDate } from "@/domain/business-date";
import { can, requirePermission } from "@/domain/permissions";
import { deliveries as t } from "@/i18n/messages/deliveries-en";
import { requireActor } from "@/server/auth/request-context";
import { getDatabase } from "@/server/db/client";
import { readDeliveryDetail } from "@/server/deliveries/queries";
import { PickupForm } from "../pickup-form";

export default async function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [actor, { id }] = await Promise.all([requireActor(), params]);
  requirePermission(actor, "deliveries.view");

  const database = getDatabase();
  const today = todayBusinessDate();

  const record = await readDeliveryDetail(database, actor, id);
  if (!record) notFound();

  const canManage = can(actor.roleCode, "deliveries.manage");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="icon">
          <Link href="/deliveries">
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Delivery Record: {record.customer.name}</h1>
          <p className="text-xs text-muted-foreground">Order Date: {record.businessDate}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t.orderedWeight}</div>
          <div className="mt-1 text-2xl font-bold">{record.orderedWeight} TON</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t.deliveredWeight}</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            {record.deliveredWeight} TON
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t.remainingWeight}</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">
            {record.remainingWeight} TON
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t.history}</h2>
        {canManage && !record.isComplete && (
          <PickupForm
            deliveryRecordId={record.id}
            customerName={record.customer.name}
            remainingWeight={record.remainingWeight}
            today={today}
          />
        )}
      </div>

      {/* Pickups Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="p-3.5">{t.pickupDate}</th>
                <th className="p-3.5">{t.vehicleNo}</th>
                <th className="p-3.5 text-right">{t.deliveredWeight}</th>
                <th className="p-3.5">{t.notes}</th>
                <th className="p-3.5">Logged By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {record.pickups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    {t.noPickups}
                  </td>
                </tr>
              ) : (
                record.pickups.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="whitespace-nowrap p-3.5 font-medium">{p.businessDate}</td>
                    <td className="whitespace-nowrap p-3.5">
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold">
                        <Truck size={12} />
                        {p.vehicleNo || "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap p-3.5 text-right font-semibold text-emerald-600">
                      {p.weight} TON
                    </td>
                    <td className="p-3.5 text-xs text-muted-foreground">{p.notes || "—"}</td>
                    <td className="whitespace-nowrap p-3.5 text-xs text-muted-foreground">
                      {p.createdByName}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
