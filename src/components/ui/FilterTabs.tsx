"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * The category rail — "ALL CRAFTS / TEXTILES & WEAVING / BLUE POTTERY …",
 * "All Updates / Market Trends / Govt Policy".
 *
 * Active is a charcoal fill with white text; everything else is a light warm
 * pill. It scrolls rather than wrapping: there are six or seven of these and
 * equal columns would crush the labels on a 360px screen. The rail bleeds to
 * the gutter with `-mx-*`, and `.kg-rail` puts the snap point back where the
 * page gutter is.
 */
export interface FilterTabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  caps = true,
  className,
}: {
  options: FilterTabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  /** Mono uppercase (marketplace) vs sentence case (news). */
  caps?: boolean;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "kg-rail -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6",
        className
      )}
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
              "kg-press flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-5",
              caps ? "kg-label font-medium" : "text-[13px] font-semibold",
              active
                ? "bg-primary text-white"
                : "bg-[var(--color-pill)] text-gray-600 hover:bg-[#E3DCD2] hover:text-gray-900"
            )}
          >
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

/**
 * A single neutral pill. Used for the Filter / Sort controls beside a page
 * title, and for the chips on the eligibility card.
 */
export function Pill({
  children,
  icon,
  onClick,
  href,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "neutral" | "dark" | "onDark" | "onDarkMuted";
  className?: string;
}) {
  const TONES = {
    neutral: "bg-[var(--color-pill)] text-gray-700 hover:bg-[#E3DCD2]",
    dark: "bg-primary text-white hover:bg-primary-dark",
    onDark: "bg-white/10 text-white",
    onDarkMuted: "bg-white/[0.06] text-white/50",
  } as const;

  const cls = cn(
    "kg-press inline-flex min-h-[42px] items-center gap-2 rounded-full px-4 text-[13px] font-semibold",
    TONES[tone],
    className
  );

  if (href) {
    return (
      <a href={href} className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span className={cls}>
      {icon}
      {children}
    </span>
  );
}
