import React from "react";
import { cn } from "@/lib/utils";

/**
 * The tracked uppercase micro-label — "ARTISAN VIEW", "MONTHLY OVERVIEW",
 * "CENTRAL SCHEME", "HERITAGE TECH ECOSYSTEM".
 *
 * Set in the mono face (`.kg-label`), which is what carries the drafting-label
 * feel of the design. It is deliberately the *only* thing in the layout that is
 * uppercase: the serif headings beneath it stay sentence case, and the contrast
 * between the two is the whole editorial rhythm.
 */
export function SectionEyebrow({
  children,
  tone = "muted",
  as: Tag = "p",
  className,
}: {
  children: React.ReactNode;
  /** `maroon` for a category label above an article or scheme title. */
  tone?: "muted" | "maroon" | "rust" | "light";
  as?: "p" | "span" | "h2" | "div";
  className?: string;
}) {
  const TONES = {
    muted: "text-gray-500",
    maroon: "text-[var(--color-maroon)]",
    rust: "text-[var(--color-rust)]",
    light: "text-white/55",
  } as const;

  return (
    <Tag className={cn("kg-label font-medium", TONES[tone], className)}>{children}</Tag>
  );
}

/**
 * A display heading in the serif face, with the maroon rule the references draw
 * under "Recent Articles".
 *
 * The optional `action` sits on the baseline at the right — "VIEW ALL →",
 * a filter control. It is a flex row rather than an absolutely positioned
 * element so a long heading pushes it rather than running underneath it.
 */
export function SectionHeading({
  children,
  action,
  rule = false,
  size = "md",
  className,
  id,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  /** The 64px maroon underline. */
  rule?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  id?: string;
}) {
  const SIZES = {
    sm: "text-lg sm:text-xl",
    md: "text-2xl sm:text-[28px]",
    lg: "text-3xl sm:text-4xl",
  } as const;

  return (
    <div
      className={cn(
        "flex items-end justify-between gap-4 flex-wrap",
        rule ? "mb-7" : "mb-4",
        className
      )}
    >
      <h2
        id={id}
        className={cn(
          "kg-display text-gray-900 leading-tight min-w-0",
          SIZES[size],
          rule && "kg-rule-maroon"
        )}
      >
        {children}
      </h2>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * The very large serif page title the references open every page with —
 * "Schemes & Funding", "Marketplace".
 */
export function PageTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "kg-display text-gray-900 text-[38px] leading-[1.05] sm:text-5xl lg:text-[56px]",
        className
      )}
    >
      {children}
    </h1>
  );
}

/** The one-or-two-line grey line that sits under a `PageTitle`. */
export function PageLede({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-600", className)}>
      {children}
    </p>
  );
}
