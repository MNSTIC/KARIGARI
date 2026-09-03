"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A row of five stars — read-only display by default, clickable when a picker.
 *
 * `rating` accepts a fractional value for aggregates (e.g. `4.3`); the row
 * fills up to the floor and leaves the rest empty. Only the interactive mode
 * emits state changes, and that mode always operates in whole stars.
 */
export function StarRating({
  rating,
  size = 14,
  interactive = false,
  onChange,
  ariaLabel,
  className,
}: {
  /** 0..5. Rounded down to a whole star for the fill. */
  rating: number;
  size?: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const filled = Math.max(0, Math.min(5, Math.floor(rating)));

  return (
    <div
      className={cn("inline-flex items-center gap-0.5", className)}
      role={interactive ? "radiogroup" : "img"}
      aria-label={ariaLabel || `${rating.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((step) => {
        const active = step <= filled;
        const StarNode = (
          <Star
            size={size}
            className={
              active
                ? "text-yellow-500 fill-yellow-500"
                : "text-gray-300"
            }
          />
        );
        if (!interactive) return <span key={step}>{StarNode}</span>;

        return (
          <button
            key={step}
            type="button"
            role="radio"
            aria-checked={step === filled}
            aria-label={`${step} star${step > 1 ? "s" : ""}`}
            onClick={() => onChange?.(step)}
            className="kg-press p-0.5"
          >
            {StarNode}
          </button>
        );
      })}
    </div>
  );
}
