import React from "react";
import { cn } from "@/lib/utils";

/**
 * The settlement stepper — SOLD → SHIPPED → SETTLED.
 *
 * The labels sit above a single track whose fill is driven off the reached
 * index, exactly as the dashboard reference draws it. It is read-only: nothing
 * here can advance an escrow stage. Both tranches are written by the escrow
 * engine on a dispatch/delivery trigger, and this only reports where the item
 * has actually got to.
 */
export function ProgressStepper({
  steps,
  current,
  className,
}: {
  steps: string[];
  /** Index of the furthest step reached. -1 for "not started". */
  current: number;
  className?: string;
}) {
  const total = Math.max(1, steps.length - 1);
  const reached = Math.max(-1, Math.min(steps.length - 1, current));
  // A stepper with one step reached out of three should show a third of the
  // track filled, not nothing — so the fill is measured from the first label's
  // centre, which is where the track visually begins.
  const pct = reached <= 0 ? (reached === 0 ? 8 : 0) : (reached / total) * 100;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {steps.map((step, index) => (
          <span
            key={step}
            className={cn(
              "kg-label font-medium",
              index === 0 && "text-left",
              index === steps.length - 1 && "text-right",
              index <= reached ? "text-gray-900" : "text-gray-400"
            )}
          >
            {step}
          </span>
        ))}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length - 1}
        aria-valuenow={Math.max(0, reached)}
        aria-label={steps.join(" then ")}
        className="h-[3px] w-full rounded-full bg-gray-300/70"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
