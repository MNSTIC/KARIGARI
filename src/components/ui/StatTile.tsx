import React from "react";
import { cn } from "@/lib/utils";

/**
 * One figure from the overview row: a soft grey tile with a tracked mono label
 * and a large serif number, exactly as the dashboard reference draws it.
 *
 * The number is set in the serif display face. That is safe for rupee totals
 * because `globals.css` keeps Inter last in the serif stack, so U+20B9 falls
 * through to a font that actually has the glyph instead of rendering as tofu —
 * the bug that made "₹10,330" show as "?10,330" on the old dashboard.
 */

export type StatAccent = "teal" | "orange" | "blue" | "brown";

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  accent?: StatAccent;
  /** "+1 this month". Rendered quietly beneath the figure. */
  delta?: string | null;
  className?: string;
}

export function StatTile({ label, value, icon, delta, className }: StatTileProps) {
  return (
    <div
      className={cn(
        "flex min-h-[120px] flex-col justify-between rounded-2xl bg-[var(--color-gray-100)] p-4 sm:p-5",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <span className="kg-label min-w-0 flex-1 font-medium text-gray-500">{label}</span>
        {icon && <span className="shrink-0 text-gray-400">{icon}</span>}
      </div>

      <div className="mt-4">
        <span className="kg-display block text-[30px] leading-none text-gray-900 sm:text-[34px]">
          {value}
        </span>
        {delta && <span className="mt-1.5 block text-[11px] text-gray-500">{delta}</span>}
      </div>
    </div>
  );
}

/**
 * The headline figure above the tiles — "MONTHLY OVERVIEW / ₹42,500 / +12% vs
 * last month". One block, because the eyebrow, the number and the delta have to
 * stay on the same baseline grid at every width.
 */
export function HeadlineStat({
  eyebrow,
  value,
  delta,
  deltaIcon,
  className,
}: {
  eyebrow: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaIcon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="kg-label font-medium text-gray-500">{eyebrow}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="kg-display text-[44px] leading-none text-gray-900 sm:text-[60px]">
          {value}
        </span>
        {delta && (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600">
            {deltaIcon}
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
