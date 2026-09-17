"use client";

import { ShieldAlert } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { HEALTH_MAX } from "@/lib/artisanHealth";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  BAND_FAIR_MIN,
  BAND_GOOD_MIN,
  BAND_STRONG_MIN,
  CONSISTENCY_SATURATION_MONTHS,
  CONSISTENCY_WEIGHT,
  FULFILMENT_DELIVERY_POINTS,
  FULFILMENT_ON_TIME_POINTS,
  MIN_EVENTS_FOR_SCORE,
  MIN_ORDERS_FOR_FULFILMENT,
  OFFLINE_REVENUE_WEIGHT,
  PRODUCTION_SATURATION_PIECES,
  PRODUCTION_WEIGHT,
  REVENUE_SATURATION_RUPEES,
  REVENUE_WEIGHT,
  SCORE_MAX,
  SCORE_MIN,
  TRUST_GUILTY_PENALTY,
  TRUST_HEALTH_POINTS,
  TRUST_SCAN_POINTS,
  TRUST_SCAN_SATURATION,
  TRUST_WEIGHT,
  type CreditBand,
  type CreditComponent,
  type CreditProfile,
} from "@/lib/creditScore";

/**
 * The pieces of a production record that both the artisan's card and the
 * public bank page render, so the two can never describe the same snapshot
 * differently. Every figure comes from a `CreditProfile`; every weight in the
 * formula text is the exported constant from src/lib/creditScore.ts.
 */

export const BAND_KEY: Record<CreditBand, string> = {
  BUILDING: "credit_band_building",
  FAIR: "credit_band_fair",
  GOOD: "credit_band_good",
  STRONG: "credit_band_strong",
};

export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/** Points and counts: at most one decimal, Indian grouping, same on server and client. */
export function num(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

/** The honesty line. Always rendered in full — never inside a collapsed section. */
export function CreditDisclaimer({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-xl border border-gray-200 bg-[var(--color-cream)] px-3.5 py-3 text-[12.5px] leading-relaxed text-gray-700",
        className
      )}
    >
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-[var(--color-maroon)]" aria-hidden />
      <span>{t("credit_disclaimer")}</span>
    </p>
  );
}

/**
 * A 300→900 arc, drawn as inline SVG: maroon for the filled arc, rust for the
 * needle and marker, faint ticks where the bands change.
 */
export function CreditGauge({ score, band, compact = false }: { score: number; band: CreditBand; compact?: boolean }) {
  const { t } = useLanguage();
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
  const fraction = (clamped - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
  const cx = 110;
  const cy = 106;
  const r = 86;
  const at = (f: number, radius = r) => {
    const angle = Math.PI * (1 - f);
    return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
  };
  const start = at(0);
  const end = at(1);
  const tip = at(fraction);
  const needle = at(fraction, r - 26);
  const ticks = [BAND_FAIR_MIN, BAND_GOOD_MIN, BAND_STRONG_MIN].map((value) => {
    const f = (value - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
    return { value, inner: at(f, r - 13), outer: at(f, r + 13) };
  });
  const label = fill(t("credit_gauge_label"), {
    score: clamped,
    min: SCORE_MIN,
    max: SCORE_MAX,
    band: t(BAND_KEY[band]),
  });

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 220 128"
        role="img"
        aria-label={label}
        className={cn("h-auto w-full", compact ? "max-w-[220px]" : "max-w-[280px]")}
      >
        <path
          d={`M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`}
          fill="none"
          stroke="var(--color-gray-200)"
          strokeWidth={14}
          strokeLinecap="round"
        />
        {fraction > 0 && (
          <path
            d={`M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${tip.x} ${tip.y}`}
            fill="none"
            stroke="var(--color-maroon)"
            strokeWidth={14}
            strokeLinecap="round"
          />
        )}
        {ticks.map((tick) => (
          <line
            key={tick.value}
            x1={tick.inner.x}
            y1={tick.inner.y}
            x2={tick.outer.x}
            y2={tick.outer.y}
            stroke="var(--color-card)"
            strokeWidth={2}
          />
        ))}
        <line
          x1={cx}
          y1={cy}
          x2={needle.x}
          y2={needle.y}
          stroke="var(--color-rust)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill="var(--color-rust)" />
        <circle cx={tip.x} cy={tip.y} r={7.5} fill="var(--color-rust)" stroke="var(--color-card)" strokeWidth={3} />
        <text x={start.x} y={cy + 20} textAnchor="middle" fontSize="11" fill="var(--color-gray-500)" fontFamily="var(--font-mono)">
          {SCORE_MIN}
        </text>
        <text x={end.x} y={cy + 20} textAnchor="middle" fontSize="11" fill="var(--color-gray-500)" fontFamily="var(--font-mono)">
          {SCORE_MAX}
        </text>
      </svg>
      <div className={cn("text-center", compact ? "-mt-1" : "-mt-2")} aria-hidden>
        <span className="kg-label mb-1 block font-medium text-gray-500">{t("credit_score")}</span>
        <span className={cn("kg-display block leading-none text-gray-900", compact ? "text-[40px]" : "text-[52px]")}>
          {clamped}
        </span>
        <span className="kg-label mt-2 inline-block rounded-full bg-[var(--color-pink)] px-3 py-1 font-semibold text-[var(--color-maroon)]">
          {t(BAND_KEY[band])}
        </span>
      </div>
    </div>
  );
}

function basisLine(component: CreditComponent, t: (key: string) => string): string {
  const b = component.basis;
  switch (component.key) {
    case "production":
      return fill(t("credit_basis_production"), { verified: num(b.verifiedListings ?? 0), total: num(b.totalListings ?? 0) });
    case "revenue":
      return fill(t("credit_basis_revenue"), {
        escrow: formatRupees(b.realisedEarnings ?? 0),
        demand: formatRupees(b.demandEarnings ?? 0),
        offline: formatRupees(b.offlineEarnings ?? 0),
      });
    case "fulfilment":
      return fill(t("credit_basis_fulfilment"), {
        accepted: num(b.ordersAccepted ?? 0),
        delivered: num(b.ordersDelivered ?? 0),
        onTime: num(b.ordersOnTime ?? 0),
      });
    case "consistency":
      return fill(t("credit_basis_consistency"), { months: num(b.activeMonths ?? 0), age: num(b.accountAgeMonths ?? 0) });
    case "trust":
      return fill(t("credit_basis_trust"), {
        health: num(b.healthScore ?? 0),
        max: HEALTH_MAX,
        scans: num(b.buyerVerifiedScans ?? 0),
        guilty: num(b.guiltyTickets ?? 0),
      });
  }
}

/** Five bars with the real figures under each. A grey (empty) bar always says why. */
export function CreditComponentList({ profile }: { profile: CreditProfile }) {
  const { t } = useLanguage();
  return (
    <ul className="space-y-5">
      {profile.components.map((component) => {
        const name = t(component.labelKey);
        return (
          <li key={component.key} className="break-inside-avoid">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-semibold text-gray-900">{name}</span>
              <span className="shrink-0 font-mono text-[12px] text-gray-600">
                {fill(t("credit_points"), { points: num(component.points), weight: component.weight })}
              </span>
            </div>
            <ProgressBar value={component.points} max={component.weight} label={name} className="mt-2" />
            <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{basisLine(component, t)}</p>
            {component.insufficient && (
              <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
                {component.key === "fulfilment"
                  ? fill(t("credit_fulfilment_why"), {
                      min: MIN_ORDERS_FOR_FULFILMENT,
                      n: num(component.basis.ordersAccepted ?? 0),
                    })
                  : t("credit_component_empty")}
              </p>
            )}
            {component.key === "revenue" && (component.basis.offlineEarnings ?? 0) > 0 && (
              <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{t("credit_offline_weight_note")}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "How this is calculated": the exact formula with this profile's own inputs
 * substituted in, line by line, ending in the sum that gives the score.
 */
export function CreditFormula({ profile }: { profile: CreditProfile }) {
  const { t } = useLanguage();
  const i = profile.inputs;
  const points = Object.fromEntries(profile.components.map((c) => [c.key, c.points])) as Record<CreditComponent["key"], number>;
  const weighted = profile.components.find((c) => c.key === "revenue")?.basis.weightedRevenue ?? 0;
  const sum = profile.components.reduce((total, c) => total + c.points, 0);

  const lines: { key: string; text: string }[] = [
    { key: "events", text: fill(t("credit_formula_events"), {
      verified: num(i.verifiedListings),
      orders: num(i.ordersAccepted),
      sold: num(i.soldCount),
      offline: num(i.offlineSalesCount),
      n: num(profile.eventCount),
      min: MIN_EVENTS_FOR_SCORE,
    }) },
    { key: "production", text: fill(t("credit_formula_production"), {
      weight: PRODUCTION_WEIGHT,
      n: num(i.verifiedListings),
      cap: PRODUCTION_SATURATION_PIECES,
      points: num(points.production),
    }) },
    { key: "revenue", text: fill(t("credit_formula_revenue"), {
      escrow: formatRupees(i.realisedEarnings),
      demand: formatRupees(i.demandEarnings),
      half: OFFLINE_REVENUE_WEIGHT,
      offline: formatRupees(i.offlineEarnings),
      weighted: formatRupees(weighted),
      weight: REVENUE_WEIGHT,
      cap: formatRupees(REVENUE_SATURATION_RUPEES),
      points: num(points.revenue),
    }) },
    { key: "fulfilment", text: i.ordersAccepted >= MIN_ORDERS_FOR_FULFILMENT
      ? fill(t("credit_formula_fulfilment"), {
          deliveryPoints: FULFILMENT_DELIVERY_POINTS,
          onTimePoints: FULFILMENT_ON_TIME_POINTS,
          delivered: num(i.ordersDelivered),
          accepted: num(i.ordersAccepted),
          onTime: num(i.ordersOnTime),
          points: num(points.fulfilment),
        })
      : fill(t("credit_formula_fulfilment_min"), { min: MIN_ORDERS_FOR_FULFILMENT, n: num(i.ordersAccepted) }) },
    { key: "consistency", text: fill(t("credit_formula_consistency"), {
      weight: CONSISTENCY_WEIGHT,
      n: num(i.activeMonths),
      cap: CONSISTENCY_SATURATION_MONTHS,
      points: num(points.consistency),
    }) },
    { key: "trust", text: fill(t("credit_formula_trust"), {
      healthPoints: TRUST_HEALTH_POINTS,
      health: num(i.healthScore),
      healthMax: HEALTH_MAX,
      scanPoints: TRUST_SCAN_POINTS,
      scans: num(i.buyerVerifiedScans),
      scanCap: TRUST_SCAN_SATURATION,
      penalty: TRUST_GUILTY_PENALTY,
      guilty: num(i.guiltyTickets),
      weight: TRUST_WEIGHT,
      points: num(points.trust),
    }) },
  ];

  return (
    <div className="space-y-3">
      <ol className="space-y-2.5">
        {lines.map((line) => (
          <li
            key={line.key}
            className="break-inside-avoid rounded-lg bg-[var(--color-gray-50)] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]"
          >
            {line.text}
          </li>
        ))}
        {profile.score !== null && (
          <li className="break-inside-avoid rounded-lg bg-[var(--color-pill)] px-3 py-2 font-mono text-[11.5px] font-semibold leading-relaxed text-gray-900 [overflow-wrap:anywhere]">
            {num(SCORE_MIN + sum) === num(profile.score)
              ? fill(t("credit_formula_total_exact"), {
                  min: SCORE_MIN,
                  parts: profile.components.map((c) => num(c.points)).join(" + "),
                  score: profile.score,
                })
              : fill(t("credit_formula_total"), {
                  min: SCORE_MIN,
                  parts: profile.components.map((c) => num(c.points)).join(" + "),
                  exact: num(SCORE_MIN + sum),
                  score: profile.score,
                })}
          </li>
        )}
      </ol>
      <p className="text-[12px] leading-relaxed text-gray-600">
        {fill(t("credit_formula_bands"), {
          building: t("credit_band_building"),
          fairLabel: t("credit_band_fair"),
          goodLabel: t("credit_band_good"),
          strongLabel: t("credit_band_strong"),
          fair: BAND_FAIR_MIN,
          fairTop: BAND_GOOD_MIN - 1,
          good: BAND_GOOD_MIN,
          goodTop: BAND_STRONG_MIN - 1,
          strong: BAND_STRONG_MIN,
        })}
      </p>
      <p className="text-[12px] leading-relaxed text-gray-500">{t("credit_formula_note")}</p>
    </div>
  );
}

/** The raw counts behind a record, as a plain two-column table. */
export function CreditCountsTable({ profile }: { profile: CreditProfile }) {
  const { t } = useLanguage();
  const i = profile.inputs;
  const rows: { key: string; label: string; value: string }[] = [
    { key: "events", label: t("credit_count_events"), value: num(profile.eventCount) },
    { key: "verified", label: t("credit_event_verified"), value: num(i.verifiedListings) },
    { key: "total", label: t("credit_count_total"), value: num(i.totalListings) },
    { key: "sold", label: t("credit_event_sold"), value: num(i.soldCount) },
    { key: "escrow", label: t("credit_count_escrow"), value: formatRupees(i.realisedEarnings) },
    { key: "orders", label: t("credit_event_orders"), value: num(i.ordersAccepted) },
    { key: "delivered", label: t("credit_count_delivered"), value: num(i.ordersDelivered) },
    { key: "onTime", label: t("credit_count_on_time"), value: num(i.ordersOnTime) },
    { key: "demand", label: t("credit_count_demand"), value: formatRupees(i.demandEarnings) },
    { key: "offlineSales", label: t("credit_event_offline"), value: num(i.offlineSalesCount) },
    { key: "offline", label: t("credit_count_offline"), value: formatRupees(i.offlineEarnings) },
    { key: "months", label: t("credit_count_active_months"), value: num(i.activeMonths) },
    { key: "age", label: t("credit_count_account_age"), value: num(i.accountAgeMonths) },
    { key: "scans", label: t("credit_count_scans"), value: num(i.buyerVerifiedScans) },
    { key: "guilty", label: t("credit_count_guilty"), value: num(i.guiltyTickets) },
    { key: "health", label: t("credit_count_health"), value: `${num(i.healthScore)}/${HEALTH_MAX}` },
  ];
  return (
    <table className="w-full text-left text-[13px]">
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-gray-100 last:border-0">
            <th scope="row" className="py-2 pr-3 font-normal text-gray-600">
              {row.label}
            </th>
            <td className="py-2 text-right font-mono font-semibold text-gray-900">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
