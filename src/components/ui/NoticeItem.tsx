import React from "react";
import { cn } from "@/lib/utils";

/**
 * One row on the Notice Board: a coloured left rule, a tracked label/date line,
 * then the body.
 *
 * `urgent` is the only variant that gets the maroon rule — if every notice were
 * urgent none of them would be.
 */
export function NoticeItem({
  label,
  meta,
  children,
  tone = "default",
  className,
}: {
  label: string;
  /** Right-hand side of the label line: a date, a cluster name. */
  meta?: string;
  children: React.ReactNode;
  tone?: "default" | "urgent";
  className?: string;
}) {
  return (
    <li
      className={cn(
        "rounded-xl border-l-[3px] bg-card px-4 py-3.5 shadow-card",
        tone === "urgent" ? "border-l-[var(--color-maroon)]" : "border-l-gray-300",
        className
      )}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "kg-label font-medium",
            tone === "urgent" ? "text-[var(--color-maroon)]" : "text-gray-500"
          )}
        >
          {label}
        </span>
        {meta && <span className="kg-label shrink-0 text-gray-400">{meta}</span>}
      </div>
      <p className="text-[14px] font-medium leading-relaxed text-gray-800">{children}</p>
    </li>
  );
}

/**
 * A price movement on the dark Market Alerts card: a circular direction chip,
 * the material, the move, and what it means.
 */
export function AlertRow({
  material,
  change,
  note,
  direction,
}: {
  material: string;
  change: string;
  note?: string;
  direction: "up" | "down" | "flat";
}) {
  const CHIPS = {
    up: "bg-[var(--color-maroon)] text-white",
    down: "bg-white/10 text-white/80",
    flat: "bg-white/10 text-white/60",
  } as const;

  return (
    <li className="flex gap-3.5 border-b border-white/10 py-4 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          CHIPS[direction]
        )}
      >
        {direction === "up" ? "↑" : direction === "down" ? "↓" : "→"}
      </span>
      <div className="min-w-0">
        <p className="kg-label font-medium text-white/55">{material}</p>
        <p className="kg-display mt-1 text-[20px] leading-none text-white">{change}</p>
        {note && <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{note}</p>}
      </div>
    </li>
  );
}
