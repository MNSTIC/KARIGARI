import React from "react";
import { cn } from "@/lib/utils";

/**
 * The trust-health / fair-wage / bulk-group bar.
 *
 * Exposes real `progressbar` semantics rather than two nested divs, and clamps
 * its own value: a fair-wage index computed from live settlement data can
 * legitimately come back above 100, and an unclamped bar would render a fill
 * that runs past its track.
 */

export type ProgressTone = "primary" | "success" | "warning" | "danger";

const FILLS: Record<ProgressTone, string> = {
  primary: "bg-primary",
  success: "bg-[var(--color-stat-teal)]",
  warning: "bg-[var(--color-stat-brown)]",
  danger: "bg-[var(--color-stat-orange)]",
};

export function ProgressBar({
  value,
  max = 100,
  tone = "primary",
  label,
  size = "md",
  className,
}: {
  value: number;
  max?: number;
  tone?: ProgressTone;
  /** Accessible name. Falls back to a generic one when omitted. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  return (
    <div
      role="progressbar"
      aria-label={label || "Progress"}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "w-full rounded-full bg-gray-200 overflow-hidden",
        size === "sm" ? "h-1.5" : "h-2",
        className
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", FILLS[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * A value's position inside a min/max band — the Market Price Band marker on
 * the craft passport.
 *
 * Degrades to the midpoint when the band is degenerate (min === max), which
 * happens on items whose valuation never ran; a NaN there would drop the
 * marker off the track entirely.
 */
export function BandMarker({
  min,
  max,
  value,
  minLabel,
  maxLabel,
  caption,
}: {
  min: number;
  max: number;
  value: number;
  minLabel: string;
  maxLabel: string;
  caption?: string;
}) {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 50;

  return (
    <div>
      <div className="flex justify-between text-[11px] font-bold text-gray-500 mb-1.5">
        <span className="font-sans">{minLabel}</span>
        <span className="font-sans">{maxLabel}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-gray-200">
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[var(--color-stat-brown)] border-2 border-white shadow-card transition-[left] duration-500 ease-out"
          style={{ left: `${pct}%` }}
        />
      </div>
      {caption && <p className="text-[11px] text-gray-500 mt-2 text-center font-sans">{caption}</p>}
    </div>
  );
}
