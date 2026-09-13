"use client";

import { useState } from "react";
import Image from "next/image";
import { Box, CheckCircle2, Clock, Loader2, ScanLine, ShoppingBag, Truck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * One marketplace sale on the artisan's Orders page.
 *
 * A storefront sale is a finished, already-verified piece someone bought
 * outright, so its ladder is short and every rung is a real event with its own
 * timestamp: Paid → Packed → Dispatched → Delivered. It does NOT reuse the
 * demand-order card, whose Ready step is a verification a storefront piece
 * already passed before it could be listed at all.
 *
 * The card owns only its own form state. Every change goes to the server and
 * the page reloads the list, so what is shown is always what was recorded —
 * never an optimistic guess about whether an advance released.
 */

export interface StorefrontSale {
  kind: "storefront";
  id: string;
  craftType: string;
  image: string | null;
  patchId: string | null;
  stage: string;
  nextAction: "pack" | "dispatch" | null;
  buyerName: string | null;
  price: number | null;
  paidAt: string | null;
  packedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  courierName: string | null;
  trackingRef: string | null;
  escrowStatus: string | null;
  advanceAmount: number | null;
  finalSettlementAmount: number | null;
  advanceReleased: number;
  finalReleased: number;
  payoutReal: boolean;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function StorefrontSaleCard({
  sale,
  onChanged,
}: {
  sale: StorefrontSale;
  /** Called after any successful action, with a message to show. */
  onChanged: (message: string) => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [courierName, setCourierName] = useState("");
  const [trackingRef, setTrackingRef] = useState("");

  const buyer = sale.buyerName || t("sale_a_buyer");
  const advance = sale.advanceAmount ?? 0;
  const final = sale.finalSettlementAmount ?? 0;

  const act = async (action: "pack" | "dispatch") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/artisan/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftItemId: sale.id,
          action,
          ...(action === "dispatch" ? { courierName, trackingRef } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(data?.error || t("sale_action_failed"));
        return;
      }
      if (action === "pack") {
        onChanged(t("sale_packed_toast"));
      } else {
        const amount = formatRupees(data?.advance?.amount ?? advance);
        // Say which kind of release happened. A recorded settlement is not
        // money in the artisan's bank, and the toast must not imply it is.
        onChanged(
          t(data?.advance?.payoutReal ? "sale_dispatched_toast" : "sale_dispatched_toast_recorded").replace(
            "{amount}",
            amount
          )
        );
        setDispatchOpen(false);
      }
    } catch {
      setError(t("sale_action_failed"));
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { key: "paid", label: t("sale_step_paid"), at: sale.paidAt, icon: <ShoppingBag size={12} /> },
    { key: "packed", label: t("stage_packed"), at: sale.packedAt, icon: <Box size={12} /> },
    { key: "dispatched", label: t("stage_dispatched"), at: sale.dispatchedAt, icon: <Truck size={12} /> },
    { key: "delivered", label: t("stage_delivered"), at: sale.deliveredAt, icon: <CheckCircle2 size={12} /> },
  ];
  const reached = steps.filter((step) => step.at).length - 1;

  return (
    <Card className="p-5">
      <div className="flex gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">
          {sale.image && (
            <Image
              src={sale.image}
              alt=""
              fill
              sizes="64px"
              unoptimized={sale.image.startsWith("data:") || sale.image.startsWith("/api/")}
              className="object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-mint)] px-2 py-0.5">
              <ShoppingBag size={10} /> {t("sale_badge")}
            </span>
          </p>
          <h3 className="truncate text-[15px] font-bold text-gray-900">{sale.craftType}</h3>
          <p className="mt-0.5 text-[13px] text-gray-600">
            {t("sale_bought_by").replace("{name}", buyer)}
            {sale.price !== null && <> · {formatRupees(sale.price)}</>}
            {sale.paidAt && <> · {t("sale_paid_on").replace("{date}", shortDate(sale.paidAt))}</>}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------ Ladder */}
      <ol className="mt-5 grid grid-cols-4 gap-1" aria-label={t("sale_badge")}>
        {steps.map((step, index) => {
          const done = index <= reached;
          return (
            <li key={step.key} className="min-w-0">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  done ? "bg-primary" : "bg-gray-200"
                )}
              />
              <p
                className={cn(
                  "mt-1.5 flex items-center gap-1 truncate text-[11px] font-semibold",
                  done ? "text-gray-900" : "text-gray-400"
                )}
              >
                {step.icon}
                {step.label}
              </p>
              {step.at && <p className="text-[10px] text-gray-500">{shortDate(step.at)}</p>}
            </li>
          );
        })}
      </ol>

      {/* ------------------------------------------------ Money */}
      <dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-[12px]">
        <div>
          <dt className="text-gray-500">{t("sale_advance_line")}</dt>
          <dd className="font-bold text-gray-900">
            {formatRupees(advance)}{" "}
            <span className={sale.advanceReleased > 0 ? "text-primary" : "text-gray-400"}>
              · {t(sale.advanceReleased > 0 ? "sale_released" : "sale_pending")}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">{t("sale_final_line")}</dt>
          <dd className="font-bold text-gray-900">
            {formatRupees(final)}{" "}
            <span className={sale.finalReleased > 0 ? "text-primary" : "text-gray-400"}>
              · {t(sale.finalReleased > 0 ? "sale_released" : "sale_pending")}
            </span>
          </dd>
        </div>
        {!sale.payoutReal && (
          <p className="col-span-2 text-[11px] leading-relaxed text-gray-500">{t("sale_not_bank_note")}</p>
        )}
      </dl>

      {sale.courierName || sale.trackingRef ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-gray-600">
          <Truck size={13} className="shrink-0" />
          {[sale.courierName, sale.trackingRef].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
          {error}
        </p>
      )}

      {/* ------------------------------------------------ Next action */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sale.nextAction === "pack" && (
          <>
            {sale.patchId && (
              <p className="flex w-full items-center gap-1.5 text-[12px] text-gray-600">
                <ScanLine size={13} className="shrink-0" />
                {t("sale_patch_hint").replace("{patch}", sale.patchId)}
              </p>
            )}
            <button
              type="button"
              onClick={() => void act("pack")}
              disabled={busy}
              className={cn(
                "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                busy && "cursor-not-allowed opacity-50"
              )}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Box size={13} />}
              {t("orders_mark_packed")}
            </button>
          </>
        )}

        {sale.nextAction === "dispatch" &&
          (dispatchOpen ? (
            <div className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <label className="min-w-[140px] flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("orders_courier")}
                </span>
                <input
                  className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-primary"
                  value={courierName}
                  onChange={(e) => setCourierName(e.target.value)}
                  placeholder={t("orders_courier_placeholder")}
                  disabled={busy}
                />
              </label>
              <label className="min-w-[140px] flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {t("orders_tracking")}
                </span>
                <input
                  className="min-h-[40px] w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-primary"
                  value={trackingRef}
                  onChange={(e) => setTrackingRef(e.target.value)}
                  placeholder={t("orders_tracking_placeholder")}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                onClick={() => void act("dispatch")}
                disabled={busy}
                className={cn(
                  "kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark",
                  busy && "cursor-not-allowed opacity-50"
                )}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Truck size={13} />}
                {t("sale_dispatch_release")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDispatchOpen(true)}
              className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark"
            >
              <Truck size={13} /> {t("orders_mark_dispatched")}
            </button>
          ))}

        {sale.nextAction === null && sale.dispatchedAt && !sale.deliveredAt && (
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-gray-600">
            <Clock size={13} className="mt-0.5 shrink-0" />
            {t("sale_waiting_buyer").replace("{name}", buyer).replace("{amount}", formatRupees(final))}
          </p>
        )}
      </div>
    </Card>
  );
}
