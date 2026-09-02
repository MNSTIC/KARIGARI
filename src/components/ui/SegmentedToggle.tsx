"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * The two-or-three-way control used for Master/Standard pricing and
 * Restock/Bulk Buy.
 *
 * Rendered as real buttons in a `radiogroup`, not styled divs: this is a
 * single choice out of a set, and a screen reader has to be told that. Each
 * segment is 44px tall so it stays a usable tap target on a phone.
 */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "md",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("grid gap-1 rounded-xl bg-[var(--color-pill)] p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "kg-press flex min-w-0 items-center justify-center gap-1.5 rounded-lg font-semibold",
              size === "sm" ? "min-h-[38px] px-2 text-[11px]" : "min-h-[44px] px-3 text-xs",
              active
                ? "bg-white text-gray-900 shadow-card"
                : "text-gray-500 hover:text-gray-800"
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The horizontal filter rail — ALL / LIVE / VERIFYING / SOLD.
 *
 * Separate from `SegmentedToggle` because it scrolls rather than dividing the
 * width evenly: there are five or six of these and equal columns would crush
 * the labels on a 360px screen. Same look as `FilterTabs`: charcoal fill for
 * the active tab, warm neutral for the rest.
 */
export function PillTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { value: T; label: string; count?: number; icon?: React.ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("kg-rail -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "kg-press flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-5 text-[13px] font-semibold",
              active
                ? "bg-primary text-white"
                : "bg-[var(--color-pill)] text-gray-600 hover:bg-[#E3DCD2] hover:text-gray-900"
            )}
          >
            {option.icon}
            {option.label}
            {typeof option.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                  active ? "bg-white/20" : "bg-white/70 text-gray-600"
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
