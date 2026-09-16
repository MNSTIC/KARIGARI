"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  PackageCheck,
  RefreshCw,
  Store,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * The artisan's Shopify shop, in the Syndication Hub.
 *
 * Distinct from the export-only channels above it on purpose: this is the one
 * channel where "live" means a buyer can open a real storefront and pay. Every
 * state shown here was written by POST /api/artisan/shopify/publish after
 * Shopify confirmed it; this component never infers a publish.
 *
 * Absent — not broken — when the deployment has no Shopify store: the flag is
 * off, or GET /api/artisan/shopify answers 503.
 */

export const SHOPIFY_CARD_ENABLED = process.env.NEXT_PUBLIC_SHOPIFY_ENABLED === "true";

export interface ShopifyCardItem {
  id: string;
  craftType: string;
  askingPrice: number | null;
  standardMarketPrice: number | null;
  status: string;
  isListedOnMarketplace: boolean;
  paidAt?: string | null;
}

interface ItemState {
  id: string;
  status: "NOT_PUBLISHED" | "PUBLISHING" | "LIVE" | "FAILED" | "WITHDRAWN" | null;
  error: string | null;
  productUrl: string | null;
  lookChanged: boolean;
}

interface ShopState {
  shopUrl: string | null;
  productCount: number;
  items: Record<string, ItemState>;
}

const SOLD = ["SOLD_FINAL", "SOLD_MIDDLEMAN", "SOLD_OFFLINE"];

export function ShopifyShopCard({ items }: { items: ShopifyCardItem[] }) {
  const { t } = useLanguage();
  const [load, setLoad] = useState<"loading" | "ready" | "absent" | "error">("loading");
  const [shop, setShop] = useState<ShopState>({ shopUrl: null, productCount: 0, items: {} });
  /** Items with a publish request in flight from THIS tab. */
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  /** A refusal the server gave before it claimed the row (not sellable, no price…). */
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/artisan/shopify", { cache: "no-store" });
      if (res.status === 503) {
        setLoad("absent");
        return;
      }
      const data = await res.json();
      if (!res.ok || !data?.configured) {
        setLoad("error");
        return;
      }
      setShop({
        shopUrl: data.shop?.shopUrl ?? null,
        productCount: data.productCount ?? 0,
        items: Object.fromEntries((data.items ?? []).map((i: ItemState) => [i.id, i])),
      });
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, []);

  useEffect(() => {
    if (!SHOPIFY_CARD_ENABLED) return;
    // Deferred so the effect body performs no synchronous setState — the same
    // kickoff pattern the market page itself uses.
    const kickoff = setTimeout(refresh, 0);
    return () => clearTimeout(kickoff);
  }, [refresh]);

  const publish = async (itemId: string) => {
    setInFlight((prev) => ({ ...prev, [itemId]: true }));
    setRefusals((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    try {
      const res = await fetch("/api/artisan/shopify/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftItemId: itemId }),
      });
      const data = await res.json().catch(() => ({}));
      // A refusal before the claim (400/404/409) leaves no FAILED row behind,
      // so its reason is kept here; everything else is re-read from the server.
      if (!res.ok && !data?.status && data?.error) {
        setRefusals((prev) => ({ ...prev, [itemId]: data.error }));
      }
    } catch {
      setRefusals((prev) => ({ ...prev, [itemId]: t("shopify_network_error") }));
    } finally {
      await refresh();
      setInFlight((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const copyLink = async () => {
    if (!shop.shopUrl) return;
    try {
      await navigator.clipboard.writeText(shop.shopUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (insecure context, permissions): the link is still
      // visible and selectable, so there is nothing more to do.
    }
  };

  if (!SHOPIFY_CARD_ENABLED || load === "absent") return null;

  return (
    <section
      aria-labelledby="shopify-card-title"
      className="bg-card rounded-2xl border border-gray-100 shadow-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="shopify-card-title" className="flex items-center gap-2 text-lg font-serif font-bold text-primary">
            <Store size={18} className="text-[var(--color-maroon)]" aria-hidden="true" />
            {t("shopify_title")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">{t("shopify_desc")}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-green-50)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-green-700)]">
          {t("shopify_live_badge")}
        </span>
      </div>

      {load === "loading" ? (
        <p role="status" className="mt-5 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t("shopify_loading")}
        </p>
      ) : load === "error" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-600">{t("shopify_load_failed")}</p>
          <button
            type="button"
            onClick={() => {
              setLoad("loading");
              void refresh();
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-bold text-primary hover:bg-gray-50"
          >
            <RefreshCw size={14} aria-hidden="true" /> {t("shopify_retry")}
          </button>
        </div>
      ) : (
        <>
          {/* Shop link + live count */}
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            {shop.shopUrl ? (
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1.5 pl-3">
                <a
                  href={shop.shopUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-bold text-primary underline-offset-2 hover:underline"
                >
                  {shop.shopUrl.replace(/^https?:\/\//, "")}
                </a>
                <button
                  type="button"
                  onClick={copyLink}
                  aria-label={t("shopify_copy_link")}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-primary border border-gray-200 hover:bg-gray-100"
                >
                  {copied ? <CheckCircle2 size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span aria-live="polite">{copied ? t("shopify_copied") : t("shopify_copy")}</span>
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">{t("shopify_no_shop_yet")}</p>
            )}
            <p className="text-sm font-bold text-gray-800">
              {t("shopify_product_count").replace("{count}", String(shop.productCount))}
            </p>
          </div>

          {/* Per-item actions */}
          {items.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm italic text-gray-500">
              {t("shopify_no_items")}
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-gray-100">
              {items.map((item) => {
                const state = shop.items[item.id];
                const busy = inFlight[item.id] || state?.status === "PUBLISHING";
                const sold = Boolean(item.paidAt) || SOLD.includes(item.status);
                const refusal = refusals[item.id];
                const price = item.askingPrice ?? item.standardMarketPrice;

                return (
                  <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-900">{item.craftType}</p>
                      {/* font-sans: the display face has no rupee glyph. */}
                      <p className="font-sans text-xs text-gray-500">{price ? formatRupees(price) : "—"}</p>
                    </div>

                    {/* A fixed minimum height keeps the row still when a status flips. */}
                    <div className="flex min-h-[44px] flex-wrap items-center gap-2 sm:justify-end">
                      {busy ? (
                        <span role="status" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gray-100 px-4 text-sm font-bold text-gray-600">
                          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t("shopify_publishing")}
                        </span>
                      ) : state?.status === "WITHDRAWN" ? (
                        <span className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-600">
                          <PackageCheck size={14} aria-hidden="true" /> {t("shopify_withdrawn")}
                        </span>
                      ) : state?.status === "LIVE" ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-green-700)]">
                            <CheckCircle2 size={16} aria-hidden="true" /> {t("shopify_live")}
                          </span>
                          {state.productUrl && (
                            <a
                              href={state.productUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-sm font-bold text-primary hover:bg-gray-50"
                            >
                              <ExternalLink size={14} aria-hidden="true" /> {t("shopify_view")}
                            </a>
                          )}
                          {(state.lookChanged || state.error) && (
                            <button
                              type="button"
                              onClick={() => publish(item.id)}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--color-maroon)] px-4 text-sm font-bold text-white hover:opacity-90"
                            >
                              <RefreshCw size={14} aria-hidden="true" /> {t("shopify_update")}
                            </button>
                          )}
                        </>
                      ) : state?.status === "FAILED" ? (
                        <button
                          type="button"
                          onClick={() => publish(item.id)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--color-maroon)] px-4 text-sm font-bold text-white hover:opacity-90"
                        >
                          <RefreshCw size={14} aria-hidden="true" /> {t("shopify_retry")}
                        </button>
                      ) : sold ? (
                        <span className="text-sm text-gray-500">{t("shopify_sold")}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => publish(item.id)}
                          disabled={!item.isListedOnMarketplace}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--color-maroon)] px-4 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Store size={14} aria-hidden="true" /> {t("shopify_publish")}
                        </button>
                      )}
                    </div>

                    {/* Reasons, full width under the row. */}
                    {(state?.error || refusal || (!item.isListedOnMarketplace && !state?.status && !sold)) && (
                      <p
                        className={cn(
                          state?.error || refusal
                            ? "flex basis-full gap-1.5 rounded-lg bg-[var(--color-red-50)] px-3 py-2 text-xs text-[var(--color-red-700)] sm:order-last"
                            : "basis-full text-xs text-gray-500 sm:order-last",
                          // Kept in place (no layout shift) but dimmed: it describes the
                          // attempt before the one now running.
                          busy && "opacity-50"
                        )}
                      >
                        {(state?.error || refusal) && <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
                        {state?.error || refusal || t("shopify_not_ready")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-gray-500">{t("shopify_footnote")}</p>
        </>
      )}
    </section>
  );
}
