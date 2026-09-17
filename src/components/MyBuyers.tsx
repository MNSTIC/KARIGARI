"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, Building2, ChevronDown, Repeat2, Search, Users, Wallet } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { SectionHeading, SectionLabel } from "@/components/ui/SectionLabel";
import { StatTile } from "@/components/ui/StatTile";
import type { Buyer, BuyerChannel, BuyersSummary, DemandSignals } from "@/lib/buyers";

/**
 * "My buyers" — the artisan's buyer network, built from sales that already
 * happened. Nothing here is typed in by the artisan and nothing is sample data:
 * with no named buyer yet, the panel says so.
 *
 * Money on this tab is money RECEIVED (released tranches, settled credits,
 * logged cash), on the same basis as the Money tab, so the two reconcile.
 */

const BuyersMonthlyChart = dynamic(
  () => import("@/components/BuyersMonthlyChart").then((m) => m.BuyersMonthlyChart),
  { ssr: false, loading: () => <div className="kg-shimmer h-[240px] rounded-xl" /> }
);

interface BuyersPayload {
  buyers: Buyer[];
  summary: BuyersSummary;
  demandSignals: DemandSignals;
  thresholds: {
    minBuyersForRepeatRate: number;
    minSearchesForSignal: number;
    minTermSearches: number;
    unmetShare: number;
  };
}

type Filter = "all" | "repeat" | "b2b" | "offline";

/** Rows rendered before "show more"; the summary above always covers every buyer. */
const PAGE = 50;

const CHANNEL_KEY: Record<BuyerChannel, string> = {
  STOREFRONT: "buyers_channel_storefront",
  DEMAND: "buyers_channel_demand",
  OFFLINE: "buyers_channel_offline",
};

const IST_DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

export function MyBuyers() {
  const { t } = useLanguage();
  const [data, setData] = useState<BuyersPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [visible, setVisible] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/artisan/buyers", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as BuyersPayload);
      setState("ready");
    } catch (error) {
      console.warn("[my-buyers] unavailable:", (error as Error)?.message);
      setState("failed");
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const counts = useMemo(() => {
    const list = data?.buyers ?? [];
    return {
      all: list.length,
      repeat: list.filter((b) => b.isRepeat).length,
      b2b: list.filter((b) => b.isB2B).length,
      offline: list.filter((b) => b.channels.includes("OFFLINE")).length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    const list = data?.buyers ?? [];
    if (filter === "repeat") return list.filter((b) => b.isRepeat);
    if (filter === "b2b") return list.filter((b) => b.isB2B);
    if (filter === "offline") return list.filter((b) => b.channels.includes("OFFLINE"));
    return list;
  }, [data, filter]);

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setVisible(PAGE);
  };

  if (state === "loading") {
    return (
      <div aria-busy="true" className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kg-shimmer h-[120px] rounded-2xl" />
          ))}
        </div>
        <div className="kg-shimmer h-[240px] rounded-2xl" />
      </div>
    );
  }

  if (state === "failed" || !data) {
    return (
      <Card pad="lg" className="border-dashed text-center" role="alert">
        <p className="text-[14px] text-gray-600">{t("buyers_load_failed")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="kg-press mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
        >
          {t("retry")}
        </button>
      </Card>
    );
  }

  const { summary, demandSignals, thresholds } = data;
  const received = summary.revenueByChannel.storefront + summary.revenueByChannel.demand + summary.revenueByChannel.offline;
  const unnamedTotal = summary.unnamed.storefront + summary.unnamed.demand + summary.unnamed.offline;
  const hasMonthly = summary.monthly.some((m) => m.buyers > 0);

  return (
    <div className="space-y-10">
      <div>
        <SectionHeading rule>{t("buyers_title")}</SectionHeading>
        <p className="-mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-500">{t("buyers_lede")}</p>
      </div>

      {/* ------------------------------------------------------------ figures */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 kg-stagger">
        <StatTile label={t("buyers_total")} value={summary.totalBuyers} icon={<Users size={16} />} />
        <StatTile
          label={t("buyers_repeat")}
          value={summary.repeatBuyers}
          icon={<Repeat2 size={16} />}
          delta={
            summary.repeatRatePct !== null
              ? fill(t("buyers_repeat_rate"), { pct: summary.repeatRatePct })
              : fill(t("buyers_repeat_rate_needs"), { n: thresholds.minBuyersForRepeatRate, have: summary.totalBuyers })
          }
        />
        <StatTile label={t("buyers_b2b")} value={summary.b2bBuyers} icon={<Building2 size={16} />} />
        <StatTile
          label={t("buyers_received")}
          value={formatRupees(received)}
          icon={<Wallet size={16} />}
          delta={fill(t("buyers_received_parts"), {
            storefront: formatRupees(summary.revenueByChannel.storefront),
            demand: formatRupees(summary.revenueByChannel.demand),
            offline: formatRupees(summary.revenueByChannel.offline),
          })}
        />
      </div>

      {/* ------------------------------------------------------------- buyers */}
      <section aria-labelledby="buyers-list">
        <SectionLabel>
          <span id="buyers-list">{t("buyers_list_title")}</span>
        </SectionLabel>

        {summary.totalBuyers === 0 ? (
          <Card pad="lg" className="border-dashed text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-pill)] text-gray-600">
              <Users size={22} />
            </span>
            <p className="kg-display mt-4 text-[22px] text-gray-900">{t("buyers_empty_title")}</p>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-gray-500">{t("buyers_empty_body")}</p>
            <Link
              href="/artisan/market"
              className="kg-press mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
            >
              {t("buyers_empty_cta")} <ArrowRight size={15} />
            </Link>
          </Card>
        ) : (
          <>
            <FilterTabs<Filter>
              ariaLabel={t("buyers_list_title")}
              value={filter}
              onChange={changeFilter}
              caps={false}
              options={[
                { value: "all", label: t("buyers_filter_all"), count: counts.all },
                { value: "repeat", label: t("buyers_filter_repeat"), count: counts.repeat },
                { value: "b2b", label: t("buyers_filter_b2b"), count: counts.b2b },
                { value: "offline", label: t("buyers_filter_offline"), count: counts.offline },
              ]}
            />

            {filtered.length === 0 ? (
              <Card pad="lg" className="mt-4 border-dashed text-center text-[14px] text-gray-500">
                {t("buyers_filtered_empty")}
              </Card>
            ) : (
              <ul className="mt-4 space-y-3 kg-stagger">
                {filtered.slice(0, visible).map((buyer) => {
                  const expanded = open === buyer.key;
                  const panelId = `buyer-${buyer.key.replace(/[^\p{L}\p{N}]+/gu, "-")}`;
                  return (
                    <Card as="li" key={buyer.key} pad="none" className="kg-list-item overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : buyer.key)}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        className="flex w-full min-w-0 items-start gap-3 px-4 py-4 text-left hover:bg-gray-50 sm:px-5"
                      >
                        <Avatar name={buyer.displayName} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-gray-900">{buyer.displayName}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {buyer.channels.map((channel) => (
                              <Badge key={channel} variant="neutral">
                                {t(CHANNEL_KEY[channel])}
                              </Badge>
                            ))}
                            {buyer.isB2B && <Badge variant="info">{t("buyers_b2b_badge")}</Badge>}
                            {buyer.isRepeat && <Badge variant="outline">{t("buyers_repeat_badge")}</Badge>}
                          </span>
                          <span className="mt-1.5 block text-[12px] text-gray-500">
                            {fill(t("buyers_purchases"), { n: buyer.purchaseCount })} ·{" "}
                            {fill(t("buyers_last_bought"), { date: new Date(buyer.lastPurchaseAt).toLocaleDateString("en-IN", IST_DAY) })}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-sans text-[16px] font-bold text-gray-900">{formatRupees(buyer.totalValue)}</span>
                          <ChevronDown
                            size={16}
                            aria-hidden
                            className={cn("ml-auto mt-1 text-gray-400 transition-transform", expanded && "rotate-180")}
                          />
                        </span>
                      </button>
                      {expanded && (
                        <div id={panelId} className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 sm:px-5">
                          <p className="kg-label text-gray-500">
                            {fill(t("buyers_first_bought"), { date: new Date(buyer.firstPurchaseAt).toLocaleDateString("en-IN", IST_DAY) })}
                          </p>
                          <ul className="mt-2 divide-y divide-gray-200/70">
                            {buyer.items.map((item) => (
                              <li key={`${item.channel}-${item.id ?? item.title}-${item.at}`} className="flex items-center gap-3 py-2">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-gray-800">{item.title}</span>
                                  <span className="text-[11px] text-gray-500">
                                    {new Date(item.at).toLocaleDateString("en-IN", IST_DAY)} · {t(CHANNEL_KEY[item.channel])}
                                  </span>
                                </span>
                                <span className="shrink-0 font-sans text-[13px] font-semibold text-gray-900">{formatRupees(item.amount)}</span>
                              </li>
                            ))}
                          </ul>
                          {buyer.purchaseCount > buyer.items.length && (
                            <p className="mt-1 text-[11px] text-gray-500">
                              {fill(t("buyers_items_capped"), { shown: buyer.items.length, total: buyer.purchaseCount })}
                            </p>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </ul>
            )}

            {filtered.length > visible && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE)}
                  className="kg-press inline-flex min-h-[44px] items-center rounded-full bg-[var(--color-pill)] px-6 text-[13px] font-semibold text-gray-800 hover:bg-gray-200"
                >
                  {fill(t("buyers_show_more"), { n: Math.min(PAGE, filtered.length - visible) })}
                </button>
              </div>
            )}
          </>
        )}

        {unnamedTotal > 0 && (
          <p className="mt-4 text-[12px] leading-relaxed text-gray-500">{fill(t("buyers_unnamed_note"), { n: unnamedTotal })}</p>
        )}
      </section>

      {/* ------------------------------------------------------------ monthly */}
      <section aria-labelledby="buyers-monthly">
        <Card pad="md">
          <SectionLabel>
            <span id="buyers-monthly">{t("buyers_monthly_chart_title")}</span>
          </SectionLabel>
          <p className="-mt-1 mb-3 text-[13px] text-gray-500">{t("buyers_new_vs_repeat")}</p>
          {hasMonthly ? (
            <BuyersMonthlyChart months={summary.monthly} newLabel={t("buyers_new")} returningLabel={t("buyers_returning")} />
          ) : (
            <p className="py-10 text-center text-[14px] text-gray-500">{t("buyers_monthly_empty")}</p>
          )}
        </Card>
      </section>

      {/* ------------------------------------------------------ demand signal */}
      <section aria-labelledby="demand-signals">
        <Card pad="md">
          <SectionLabel>
            <span id="demand-signals">{t("demand_signals_title")}</span>
          </SectionLabel>
          <p className="-mt-1 flex items-start gap-2 text-[13px] leading-relaxed text-gray-500">
            <Search size={14} className="mt-0.5 shrink-0" />
            {demandSignals.source === "SEARCHES"
              ? fill(t("demand_signals_source_searches"), { n: demandSignals.basis, days: demandSignals.window })
              : demandSignals.source === "DEMANDS"
                ? fill(t("demand_signals_source_demands"), { n: demandSignals.basis, days: demandSignals.window })
                : fill(t("demand_signals_none"), {
                    days: demandSignals.window,
                    min: thresholds.minSearchesForSignal,
                    repeat: thresholds.minTermSearches,
                  })}
          </p>

          {demandSignals.terms.length > 0 && (
            <ul className="mt-4 divide-y divide-gray-100">
              {demandSignals.terms.map((term) => {
                const unmet = demandSignals.source === "SEARCHES" && term.zeroResultShare >= thresholds.unmetShare;
                return (
                  <li key={term.term} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] font-medium text-gray-900">
                        {unmet && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-maroon)]" />}
                        <span className="truncate">{term.term}</span>
                      </span>
                      {unmet && <span className="mt-0.5 block text-[12px] text-[var(--color-maroon)]">{t("demand_signals_unmet")}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold text-gray-600">
                      {fill(t(demandSignals.source === "SEARCHES" ? "demand_signals_searches_count" : "demand_signals_requests_count"), {
                        n: term.count,
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
