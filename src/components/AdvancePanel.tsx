"use client";

import { useState } from "react";
import Script from "next/script";
import { CheckCircle2, IndianRupee, Loader2 } from "lucide-react";
import { formatRupees } from "@/lib/pricing";
import { useRazorpayCheckout } from "@/lib/useRazorpayCheckout";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The buyer's 40% advance on one demand order.
 *
 * Three numbers appear here and they are three different things, so the panel
 * says which is which rather than letting them blur:
 *
 *   - the ADVANCE  — the real 40% of the agreed price, what the artisan is owed
 *   - the BALANCE  — the remaining 60%, due when the buyer confirms delivery
 *   - the CHARGE   — the flat ₹4 Razorpay actually takes in this demo
 *
 * And the thing it must never say: that the money reached the artisan. There is
 * no payout rail on this deployment (RAZORPAYX_ENABLED=false), so an advance is
 * a recorded settlement, not a bank credit — the same framing
 * `SETTLEMENT_LABEL` uses everywhere else.
 */

export interface AdvanceOrder {
  artisanOrderId: string;
  advanceStatus: string;
  advanceDueAmount: number | null;
  balanceDueAmount: number | null;
  advanceChargedPaise: number | null;
  advancePaidAt: string | null;
  artisanName: string;
  craftType: string;
}

export function AdvancePanel({
  order,
  buyerName,
  onPaid,
}: {
  order: AdvanceOrder;
  buyerName: string;
  /** Reload the parent's orders once the server has confirmed the advance. */
  onPaid: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const checkout = useRazorpayCheckout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to show: waived at acceptance (no price to take 40% of), or a
  // storefront purchase that never had a demand order behind it.
  if (order.advanceStatus === "ADVANCE_WAIVED" || order.advanceDueAmount === null) {
    return null;
  }

  const paid = order.advanceStatus === "ADVANCE_PAID";

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/demand-advance/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artisanOrderId: order.artisanOrderId, buyerName }),
      });
      const data = await res.json();

      // Somebody already settled it — reload rather than opening a second
      // gateway order that would take another ₹4 for nothing.
      if (data?.alreadyPaid) {
        await onPaid();
        return;
      }
      if (!res.ok || !data?.success || !data.orderId) {
        setError(data?.error || t("advance_open_failed"));
        return;
      }

      const opened = checkout.open({
        order: {
          orderId: data.orderId,
          amount: data.amount,
          currency: data.currency,
          keyId: data.keyId,
        },
        description: `${t("advance_label")} · ${order.craftType}`,
        prefill: { name: buyerName },
        onSuccess: async (response) => {
          try {
            // The modal's callback proves nothing on its own. This is the only
            // thing that decides whether an advance happened.
            const verify = await fetch("/api/payments/demand-advance/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...response,
                artisanOrderId: order.artisanOrderId,
                buyerName,
              }),
            });
            const result = await verify.json();
            if (!verify.ok || !result?.success) {
              setError(result?.error || t("advance_verify_failed"));
              return;
            }
            await onPaid();
          } catch {
            setError(t("advance_verify_failed"));
          } finally {
            setBusy(false);
          }
        },
        onDismiss: () => setBusy(false),
        onFailure: (message) => {
          setBusy(false);
          setError(message || t("payment_failed"));
        },
      });

      if (!opened) {
        setError(t("checkout_script_failed"));
        setBusy(false);
      }
    } catch {
      setError(t("advance_open_failed"));
      setBusy(false);
    }
  };

  if (paid) {
    return (
      <div className="mt-5 rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-primary">
          <CheckCircle2 size={16} /> {t("advance_paid_title")}
        </p>
        <p className="mt-1 text-[13px] text-primary/85">
          {formatRupees(order.advanceDueAmount)}
          {order.advancePaidAt
            ? ` · ${new Date(order.advancePaidAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              })}`
            : ""}
        </p>
        {order.balanceDueAmount !== null && (
          <p className="mt-1 text-xs text-primary/75">
            {t("advance_balance_due").replace("{amount}", formatRupees(order.balanceDueAmount))}
          </p>
        )}
        {/* The honesty line, in the existing muted-note style. */}
        <p className="mt-2 text-[11px] leading-relaxed text-gray-600">
          {order.advanceChargedPaise !== null
            ? t("advance_charged_note").replace(
                "{charged}",
                formatRupees(order.advanceChargedPaise / 100)
              )
            : ""}{" "}
          {t("advance_settlement_note")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
      {/* Loaded here as well as on the product page: a buyer can reach My Orders
          without ever opening a listing, and the button must work there too. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onReady={checkout.markReady}
        onError={() => setError(t("checkout_script_failed"))}
      />

      <h4 className="flex items-center gap-2 text-sm font-bold text-gray-900">
        <IndianRupee size={16} className="text-primary" /> {t("advance_due_title")}
      </h4>

      <div className="mt-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{t("advance_label")}</span>
          {/* font-sans: the serif face has no rupee glyph. */}
          <span className="font-sans font-black text-primary">
            {formatRupees(order.advanceDueAmount)}
          </span>
        </div>
        {order.balanceDueAmount !== null && (
          <div className="flex justify-between border-t border-gray-100 pt-2 text-sm">
            <span className="text-gray-600">{t("advance_balance_label")}</span>
            <span className="font-sans font-bold text-gray-900">
              {formatRupees(order.balanceDueAmount)}
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        {t("advance_why_note").replace("{artisan}", order.artisanName)}
      </p>

      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy || !checkout.ready}
        className={cn(
          "kg-press mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-dark",
          (busy || !checkout.ready) && "cursor-not-allowed opacity-50"
        )}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <IndianRupee size={15} />}
        {busy
          ? t("advance_paying")
          : !checkout.ready
            ? t("checkout_loading")
            : `${t("advance_pay_cta")} ${formatRupees(order.advanceDueAmount)}`}
      </button>

      {/* What is REALLY taken, next to what is really owed. Both, always. */}
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        {t("advance_demo_charge_note")} {t("advance_settlement_note")}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
