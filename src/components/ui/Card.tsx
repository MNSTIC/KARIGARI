import React from "react";
import { cn } from "@/lib/utils";

/**
 * The surface every page is built from.
 *
 * Before this existed each page hand-rolled its own `bg-white border
 * border-gray-200 rounded-2xl p-6 shadow-sm` string, and they had all drifted:
 * three different radii, four different paddings and two different shadows
 * across the artisan section. One component means one look.
 */

export type CardTone = "default" | "muted" | "primary" | "plain";
export type CardPad = "none" | "sm" | "md" | "lg";

const TONES: Record<CardTone, string> = {
  // Pure white on the warm canvas, with a hairline rather than a heavy border —
  // the separation in this design comes from the paper, not from an outline.
  default: "bg-card border border-gray-200/70 shadow-card",
  // The soft grey tile: stat tiles, settlement cards, the notice board panel.
  muted: "bg-[var(--color-gray-100)] border border-transparent",
  primary: "bg-primary text-white border border-transparent shadow-soft",
  // No chrome at all, for a card that only needs the radius and padding.
  plain: "",
};

const PADS: Record<CardPad, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  pad?: CardPad;
  /** Hover lift + press. Only for cards that are actually clickable. */
  interactive?: boolean;
  /** `3xl` for the big hero-scale panels the references use. */
  radius?: "2xl" | "3xl";
  /**
   * The element to render. A list of cards has to be `li` inside a `ul` or the
   * markup is invalid, and a page section reads better as `section`.
   */
  as?: "div" | "article" | "section" | "li";
}

export function Card({
  tone = "default",
  pad = "md",
  interactive = false,
  radius = "2xl",
  as = "div",
  className,
  children,
  ...rest
}: CardProps) {
  /* One shared prop bag across four possible tags: TS cannot narrow the
     per-element event handler types through a dynamic tag, and widening to
     HTMLElement at the boundary is cheaper than four overloads. */
  const Tag = as as any;

  return (
    <Tag
      className={cn(
        radius === "3xl" ? "rounded-3xl" : "rounded-2xl",
        TONES[tone],
        PADS[pad],
        interactive && "kg-lift hover:shadow-soft hover:border-gray-300 cursor-pointer",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
