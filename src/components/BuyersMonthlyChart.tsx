"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BuyerMonth } from "@/lib/buyers";

/**
 * New vs returning buyers, month by month.
 *
 * Loaded through `next/dynamic` with `ssr: false` by MyBuyers, like
 * EarningsAnalytics: recharts measures its own container and is heavy enough
 * to keep off the first paint. Counts only — the money for these months is on
 * the Money tab. Two series, so a legend is always present, and every segment
 * is named again in the tooltip rather than left to colour.
 */

const NEW_BUYERS = "var(--color-rust)";
const RETURNING = "var(--color-primary)";
const GRID = "var(--color-gray-200)";
const AXIS = "var(--color-gray-500)";

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

function monthFull(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function CountTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-soft">
      {label && <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">{monthFull(label)}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-sm text-gray-800">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-600">{entry.name}</span>
          <strong className="ml-auto pl-3 font-bold">{entry.value ?? 0}</strong>
        </p>
      ))}
    </div>
  );
}

export function BuyersMonthlyChart({
  months,
  newLabel,
  returningLabel,
}: {
  months: BuyerMonth[];
  newLabel: string;
  returningLabel: string;
}) {
  const rows = useMemo(
    () => months.map((m) => ({ month: m.month, newBuyers: m.newBuyers, returning: Math.max(0, m.buyers - m.newBuyers) })),
    [months]
  );

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 11 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: AXIS, fontSize: 11 }} />
          <Tooltip cursor={{ fill: "rgba(26,26,26,0.04)" }} content={<CountTooltip />} />
          <Legend verticalAlign="top" align="left" height={28} iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: AXIS, paddingBottom: 8 }} />
          <Bar dataKey="newBuyers" stackId="buyers" name={newLabel} fill={NEW_BUYERS} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="returning" stackId="buyers" name={returningLabel} fill={RETURNING} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
