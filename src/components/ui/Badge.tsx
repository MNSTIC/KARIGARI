import React from "react";
import { cn } from "@/lib/utils";

/**
 * Status pills.
 *
 * The variants are named after what they mean, not what colour they are, so a
 * palette change never leaves a "green" badge sitting on a failed state. The
 * status ramps come from the heritage tokens in `globals.css`, which is why
 * none of these are raw Tailwind colours.
 */

export type BadgeVariant =
  | "neutral"
  | "mint"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "solid"
  | "outline";

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-gray-100 text-gray-700 border-transparent",
  mint: "bg-[var(--color-pill)] text-gray-800 border-transparent",
  success: "bg-green-50 text-green-700 border-green-200/70",
  warning: "bg-yellow-50 text-yellow-700 border-yellow-100",
  danger: "bg-red-50 text-red-700 border-red-100",
  info: "bg-blue-50 text-blue-700 border-blue-100",
  solid: "bg-primary text-white border-transparent",
  outline: "bg-transparent text-gray-700 border-gray-300",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  /** Uppercase + tracked mono, for the overlay badges on imagery. */
  caps?: boolean;
}

export function Badge({
  variant = "neutral",
  icon,
  caps = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none",
        caps && "kg-label px-2.5 py-1.5 font-medium",
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * The provenance badge that sits on a craft photo.
 *
 * Deliberately NOT "GI TAGGED" (removed from the product earlier and staying
 * removed) and deliberately NOT "Blockchain Verified" — Karigari's provenance
 * is a printed patch ID checked against a re-photograph, so the badge says
 * exactly that. The terracotta dot is the only colour on it, matching the
 * reference.
 */
export function VerifiedOriginBadge({
  label = "Verified Origin",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-semibold text-gray-900 shadow-card backdrop-blur-sm",
        className
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-rust)]" />
      {label}
    </span>
  );
}

/**
 * The mono provenance chip — "ID: PATCH-MTHH5E5Z2932".
 *
 * Styled like the reference's ID slot, but it only ever renders a real
 * `patchId`; there is no placeholder form of this component.
 */
export function PatchIdChip({
  patchId,
  className,
}: {
  patchId: string;
  className?: string;
}) {
  return (
    <span className={cn("kg-label min-w-0 truncate text-gray-400", className)}>
      ID: {patchId}
    </span>
  );
}

/**
 * Map a `CraftItem.status` to a badge variant and label.
 *
 * Kept next to the badge rather than in each page, because the same statuses
 * are rendered on the dashboard, My Crafts and the passport, and they had
 * previously drifted into three different colour schemes for the same row.
 */
export function statusBadge(status: string): { variant: BadgeVariant; label: string } {
  switch (status) {
    case "SELLABLE":
      return { variant: "success", label: "Sellable" };
    case "VERIFIED":
      return { variant: "success", label: "Verified" };
    case "PENDING_VERIFICATION":
      return { variant: "warning", label: "Verifying" };
    case "ADVANCE_PAID":
      return { variant: "info", label: "Advance paid" };
    case "SOLD_FINAL":
      return { variant: "neutral", label: "Sold" };
    case "SOLD_MIDDLEMAN":
      return { variant: "neutral", label: "Sold off-platform" };
    case "FLAGGED":
    case "REPORTED":
      return { variant: "danger", label: "Flagged" };
    case "DRAFT_IVR":
      return { variant: "warning", label: "Draft" };
    default:
      return { variant: "neutral", label: status.replace(/_/g, " ").toLowerCase() };
  }
}
