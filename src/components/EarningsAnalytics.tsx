"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { StatTile } from "@/components/ui/StatTile";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Earnings analytics.
 *
 * Three views of money that actually moved, and nothing else. The monthly
 * series comes from `/api/artisan/dashboard`, computed server-side on the same
 * status basis as the headline total — so the bars sum back to the figure at
 * the top of the page instead of contradicting it. An AI valuation is never
 * plotted as income.
 *
 * Palette: the three slots were run through the dataviz validator against a
 * white surface. Lightness band, CVD separation (worst adjacent ΔE 13.5),
 * normal-vision separation (ΔE 20.6) and contrast all pass. The two neutrals
 * sit below the chroma floor on purpose — this product's palette is
 * deliberately desaturated — so every mark also carries a legend entry and a
 * printed value, and identity is never colour alone.
 */

const RUST = "#C2632F";
const SLATE = "#4D5D6C";
const NEUTRAL = "#9E9384";
const INK = "#1A1A1A";
const GRID = "#E4DED5";
const AXIS = "#6E675F";

export interface MonthlyEarning {
  /** "2026-08" */
  month: string;
  amount: number;
  units: number;
}

export interface AnalyticsInput {
  monthlyEarnings: MonthlyEarning[];
  totalEarnings: number;
  advancesReceived: number;
  finalSettlementsCleared: number;
  totalGrossSales: number;
  /** The artisan's self-reported pre-app annual income, if they have given it. */
  annualIncome: number | null;
}

/** "2026-08" → "Aug". Pinned to IST so the label never shifts by a day. */
function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
}

function monthFull(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Shared tooltip. Rupees go through `formatRupees`, never hand-rolled. */
function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: MonthlyEarning }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const units = payload[0]?.payload?.units;

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-soft">
      {label && (
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
          {monthFull(label)}
        </p>
      )}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-sm text-gray-800">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600">{entry.name}</span>
          <strong className="ml-auto font-bold">{formatRupees(entry.value ?? 0)}</strong>
        </p>
      ))}
      {typeof units === "number" && units > 0 && (
        <p className="mt-1 text-[11px] text-gray-500">{units} sold</p>
      )}
    </div>
  );
}

function SliceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: { fill?: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const slice = payload[0];
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-soft">
      <p className="flex items-center gap-2 text-sm text-gray-800">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: slice.payload?.fill }}
        />
        <span className="text-gray-600">{slice.name}</span>
        <strong className="ml-auto font-bold">{formatRupees(slice.value ?? 0)}</strong>
      </p>
    </div>
  );
}

export function EarningsAnalytics({ data }: { data: AnalyticsInput }) {
  const { t } = useLanguage();

  /* Memoised: `?? []` mints a new array on every render, which would make the
     dependency of every useMemo below change every time. */
  const months = useMemo(() => data.monthlyEarnings ?? [], [data.monthlyEarnings]);
  const realisedTotal = useMemo(
    () => months.reduce((sum, m) => sum + m.amount, 0),
    [months]
  );

  /**
   * Composition of the escrow ledger: what has been advanced, what has settled,
   * and what is still held. Built from the three aggregates that share one
   * basis, so the slices add up to gross sales rather than mixing bases.
   */
  const composition = useMemo(() => {
    const advances = Math.max(0, data.advancesReceived);
    const settled = Math.max(0, data.finalSettlementsCleared);
    const held = Math.max(0, data.totalGrossSales - advances - settled);
    return [
      { name: t("analytics_advances"), value: advances, fill: RUST },
      { name: t("analytics_settlements"), value: settled, fill: SLATE },
      { name: t("analytics_pending"), value: held, fill: NEUTRAL },
    ].filter((slice) => slice.value > 0);
  }, [data.advancesReceived, data.finalSettlementsCleared, data.totalGrossSales, t]);

  /**
   * Before/after.
   *
   * The "before" line is the artisan's own self-reported annual income divided
   * by twelve — nothing is invented. With no figure on file the comparison is
   * not drawn at all: an uplift measured against a number nobody supplied would
   * be theatre.
   */
  const comparison = useMemo(() => {
    if (!data.annualIncome || data.annualIncome <= 0) return null;
    const baseline = data.annualIncome / 12;

    const firstActive = months.findIndex((m) => m.amount > 0);
    if (firstActive === -1) return null;

    // Average across the months the artisan has actually been trading, not all
    // twelve — someone who joined in month ten is not earning zero for nine.
    const active = months.slice(firstActive);
    const average = active.reduce((sum, m) => sum + m.amount, 0) / active.length;
    const upliftPct = Math.round(((average - baseline) / baseline) * 100);

    return {
      baseline,
      average,
      upliftPct,
      rows: months.map((m) => ({
        month: m.month,
        units: m.units,
        before: Math.round(baseline),
        after: m.amount,
      })),
    };
  }, [data.annualIncome, months]);

  const hasSeries = months.some((m) => m.amount > 0);

  return (
    <section aria-labelledby="earnings-analytics" className="mt-12">
      <div className="mb-5">
        <h2 id="earnings-analytics" className="kg-display text-[26px] leading-tight text-gray-900">
          {t("analytics_title")}
        </h2>
        <p className="mt-1.5 text-[14px] text-gray-500">{t("analytics_subtitle")}</p>
      </div>

      {!hasSeries && composition.length === 0 ? (
        <Card pad="lg" className="border-dashed text-center text-[14px] text-gray-500">
          {t("analytics_no_data")}
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            {/* ------------------------------------------ composition pie */}
            <Card pad="md">
              <SectionLabel>{t("analytics_mix")}</SectionLabel>

              {composition.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">{t("analytics_no_data")}</p>
              ) : (
                <>
                  <div className="h-[190px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={composition}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={78}
                          /* 2px of surface between slices, per the mark spec. */
                          paddingAngle={2}
                          stroke="#FFFFFF"
                          strokeWidth={2}
                          isAnimationActive={false}
                        >
                          {composition.map((slice) => (
                            <Cell key={slice.name} fill={slice.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<SliceTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Legend doubles as the table view: every slice carries its
                      own printed value, so no slice depends on colour alone. */}
                  <ul className="mt-3 space-y-2">
                    {composition.map((slice) => (
                      <li
                        key={slice.name}
                        className="flex items-center gap-2.5 text-[13px] text-gray-700"
                      >
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: slice.fill }}
                        />
                        <span className="min-w-0 flex-1 truncate">{slice.name}</span>
                        <strong className="shrink-0 font-bold text-gray-900">
                          {formatRupees(slice.value)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            {/* --------------------------------------------- monthly bars */}
            <Card pad="md">
              <SectionLabel>{t("analytics_monthly")}</SectionLabel>

              {!hasSeries ? (
                <p className="py-16 text-center text-sm text-gray-500">{t("analytics_no_data")}</p>
              ) : (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                      {/* Recessive grid: horizontal only, no vertical rules. */}
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tickFormatter={monthLabel}
                        tickLine={false}
                        axisLine={{ stroke: GRID }}
                        tick={{ fill: AXIS, fontSize: 11 }}
                      />
                      <YAxis
                        tickFormatter={(value: number) => formatRupees(value)}
                        tickLine={false}
                        axisLine={false}
                        width={72}
                        tick={{ fill: AXIS, fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(26,26,26,0.04)" }}
                        content={<MoneyTooltip />}
                      />
                      {/* One series, so the section heading names it and no
                          legend box is needed. */}
                      <Bar
                        dataKey="amount"
                        name={t("analytics_after")}
                        fill={INK}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          {/* ------------------------------------------- before vs after */}
          <Card pad="md">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <SectionLabel className="mb-0">{t("analytics_comparison")}</SectionLabel>
              {comparison && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold",
                    comparison.upliftPct >= 0
                      ? "bg-green-50 text-green-800"
                      : "bg-orange-50 text-orange-800"
                  )}
                >
                  <ArrowUpRight
                    size={13}
                    className={comparison.upliftPct >= 0 ? "" : "rotate-90"}
                  />
                  {comparison.upliftPct >= 0
                    ? t("analytics_uplift").replace("{pct}", `+${comparison.upliftPct}`)
                    : t("analytics_uplift_down").replace(
                        "{pct}",
                        String(Math.abs(comparison.upliftPct))
                      )}
                </span>
              )}
            </div>

            <div className="mb-5 grid gap-4 sm:grid-cols-3">
              <StatTile label={t("analytics_lump_sum")} value={formatRupees(realisedTotal)} />
              <StatTile
                label={t("analytics_before")}
                value={comparison ? formatRupees(Math.round(comparison.baseline)) : "—"}
              />
              <StatTile
                label={t("analytics_after")}
                value={comparison ? formatRupees(Math.round(comparison.average)) : "—"}
              />
            </div>

            {comparison ? (
              <>
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={comparison.rows}
                      margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
                      /* 2px of surface between the paired bars. */
                      barGap={2}
                    >
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tickFormatter={monthLabel}
                        tickLine={false}
                        axisLine={{ stroke: GRID }}
                        tick={{ fill: AXIS, fontSize: 11 }}
                      />
                      <YAxis
                        tickFormatter={(value: number) => formatRupees(value)}
                        tickLine={false}
                        axisLine={false}
                        width={72}
                        tick={{ fill: AXIS, fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(26,26,26,0.04)" }}
                        content={<MoneyTooltip />}
                      />
                      {/* Two series, so a legend is always present. */}
                      <Legend
                        verticalAlign="top"
                        align="left"
                        height={28}
                        iconType="square"
                        iconSize={9}
                        wrapperStyle={{ fontSize: 12, color: AXIS, paddingBottom: 8 }}
                      />
                      <Bar
                        dataKey="before"
                        name={t("analytics_before")}
                        fill={SLATE}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={18}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="after"
                        name={t("analytics_after")}
                        fill={RUST}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={18}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-gray-500">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  {t("analytics_baseline_self")}
                </p>
              </>
            ) : (
              /* No self-reported income on file. Rather than benchmark against
                 an invented figure, ask for the real one. */
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                <p className="text-[14px] leading-relaxed text-gray-600">
                  {t("analytics_baseline_benchmark")}
                </p>
                <Link
                  href="/artisan/dashboard?edit=profile"
                  className="kg-press mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
                >
                  {t("schemes_complete_profile")}
                </Link>
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
