import React from "react";
import { cn } from "@/lib/utils";

/**
 * The charcoal feature panel — the Eligibility Profile card, Market Alerts, the
 * landing page's closing CTA, the AI assistant's header.
 *
 * The design uses exactly one dark surface and repeats it, so this is a single
 * component rather than a `bg-primary` string copied around. `arc` draws the
 * faint dashed ellipse the eligibility card carries on its right edge; it is
 * decorative, `aria-hidden`, and clipped by the card's own radius.
 */
export function DarkCard({
  children,
  className,
  pad = "lg",
  arc = false,
  radius = "3xl",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  pad?: "none" | "sm" | "md" | "lg";
  /** The dashed decorative ellipse on the right. */
  arc?: boolean;
  radius?: "2xl" | "3xl";
  as?: "div" | "section" | "aside";
}) {
  const PADS = {
    none: "",
    sm: "p-4",
    md: "p-5 sm:p-6",
    lg: "p-6 sm:p-8",
  } as const;

  return (
    <Tag
      className={cn(
        "relative overflow-hidden bg-primary text-white shadow-soft",
        radius === "3xl" ? "rounded-3xl" : "rounded-2xl",
        PADS[pad],
        className
      )}
    >
      {arc && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 top-1/2 hidden h-[150%] w-[46%] -translate-y-1/2 rounded-full border border-dashed border-white/20 sm:block"
        />
      )}
      <div className="relative z-10">{children}</div>
    </Tag>
  );
}

/**
 * The soft pink button that sits on a dark card — "UPDATE PROFILE →".
 *
 * It is the one warm note in an otherwise charcoal-and-cream palette, so it is
 * defined once here rather than as a colour string on each page.
 */
export function PinkButton({
  children,
  onClick,
  href,
  className,
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls = cn(
    "kg-press kg-label inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[var(--color-pink)] px-5 font-semibold text-[var(--color-maroon)] hover:bg-[#FBE5DC] disabled:opacity-60",
    className
  );

  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
