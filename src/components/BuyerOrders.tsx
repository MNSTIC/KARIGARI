"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Loader2, Package, ShoppingBag } from "lucide-react";
import { OrderTimeline, type TrackPayload } from "@/components/ui/OrderTimeline";
import { ORDER_STAGE_KEYS, stageIndex, type OrderStage } from "@/lib/orderStage";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";

/**
 * The buyer's own paid orders, with Flipkart/Amazon-style tracking.
 *
 * A superset of `TrackPayload`, so each order is handed straight to
 * `OrderTimeline` — the same component the demand board already uses — rather
 * than growing a second timeline that could drift from it.
 */
export interface BuyerOrder extends TrackPayload {
  key: string;
  demandId: string | null;
  craftType: string;
  artisanName: string;
  image: string | null;
  status: string;
  escrowStatus: string | null;
  productionStage: string | null;
  paidAt: string | null;
  /** Sum of the DISPLAYED prices. Never the ₹1 actually charged. */
  amountPaid: number;
  /** What Razorpay really took, in paise, so the demo charge stays visible. */
  chargedPaise: number;
}

function orderDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * The order's headline stage: the LEAST advanced piece in it.
 *
 * A bulk order is only as far along as its slowest piece — telling a buyer
 * their request is "dispatched" because one of forty sarees shipped would be
 * a lie by rounding.
 */
function headlineStage(order: BuyerOrder): OrderStage | null {
  if (order.items.length === 0) return null;
  return order.items.reduce<OrderStage>(
    (slowest, item) => (stageIndex(item.stage) < stageIndex(slowest) ? item.stage : slowest),
    order.items[0].stage
  );
}

export function BuyerOrders({
  buyerName,
  onCount,
}: {
  buyerName: string;
  /** Reports how many orders were found, so the page can title the tab. */
  onCount?: (count: number) => void;
}) {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<BuyerOrder[] | null>(null);
  const [error, setError] = useState("");

  // Held in a ref so an inline arrow from the parent cannot re-trigger the
  // fetch on every render. Assigned in an effect rather than during render,
  // which React forbids.
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  }, [onCount]);

  const load = useCallback(async () => {
    if (!buyerName.trim()) {
      setOrders([]);
      onCountRef.current?.(0);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/buyer/orders?buyer=${encodeURIComponent(buyerName)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.success && Array.isArray(data.orders)) {
        setOrders(data.orders as BuyerOrder[]);
        onCountRef.current?.(data.orders.length);
      } else {
        setError(t("orders_load_failed"));
        setOrders([]);
        onCountRef.current?.(0);
      }
    } catch (e) {
      console.error("Buyer orders failed:", e);
      setError(t("orders_load_failed"));
      setOrders([]);
      onCountRef.current?.(0);
    }
  }, [buyerName, t]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this page uses.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  if (orders === null) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-10 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-gray-600">{error}</p>
        <button
          onClick={() => void load()}
          className="kg-press mt-4 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-[13px] font-bold text-primary hover:bg-[var(--color-mint)]"
        >
          {t("track_order")}
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-mint)] text-primary">
          <ShoppingBag size={24} />
        </span>
        <h3 className="kg-display text-[22px] leading-tight text-gray-900">
          {t("orders_empty_title")}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
          {t("orders_empty_body")}
        </p>
        <Link
          href="/marketplace"
          className="kg-press mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-[13px] font-semibold text-white hover:bg-primary-dark"
        >
          {t("orders_browse_marketplace")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {orders.map((order) => {
        const stage = headlineStage(order);
        const bulk = order.requested > 1;

        return (
          <div
            key={order.key}
            className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card"
          >
            <div className="flex flex-wrap items-start gap-4 border-b border-gray-100 p-5 sm:p-6">
              {order.image ? (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                  <Image
                    src={order.image}
                    alt=""
                    fill
                    sizes="64px"
                    unoptimized={order.image.startsWith("data:")}
                    className="object-cover"
                  />
                </div>
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
                  <Package size={22} />
                </span>
              )}

              <div className="min-w-0 flex-1 basis-[55%]">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {stage && (
                    <span className="rounded-full bg-[var(--color-mint)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                      {t(ORDER_STAGE_KEYS[stage])}
                    </span>
                  )}
                  <span className="font-mono text-xs font-bold text-gray-500">
                    ORD-{order.key.split(":")[1].slice(0, 6).toUpperCase()}
                  </span>
                  {order.demandId && (
                    <span className="rounded-full bg-[var(--color-pill)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                      {t("order_for_demand")} REQ-{order.demandId.slice(0, 6).toUpperCase()}
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold leading-tight text-gray-900">
                  {bulk ? `${order.requested} × ` : ""}
                  {order.craftType}
                </h3>
                <p className="mt-0.5 truncate text-sm text-gray-500">{order.artisanName}</p>
              </div>

              {/* Full width on a phone: sharing a 360px row with the title
                  squeezed both into four-line wraps. */}
              <div className="w-full shrink-0 border-t border-gray-100 pt-3 sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
                <p className="kg-label font-medium text-gray-500">{t("order_amount_paid")}</p>
                {/* font-sans: the serif face has no rupee glyph. */}
                <p className="font-sans text-xl font-black text-primary">
                  {formatRupees(order.amountPaid)}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-gray-400">
                  {t("order_placed_on")} {orderDate(order.paidAt)}
                </p>
              </div>
            </div>

            <div className="bg-gray-50 p-5 sm:p-6">
              <OrderTimeline data={order} />
              <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                {t("order_charged_note")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
