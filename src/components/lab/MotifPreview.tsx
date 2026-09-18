"use client";

import { useMemo } from "react";
import { renderMotifSvg, type MotifSpec } from "@/lib/motifSpec";
import { cn } from "@/lib/utils";

/**
 * The live pattern preview.
 *
 * `dangerouslySetInnerHTML` is used here, and only here, for one reason that is
 * worth stating precisely: **this markup is not user content.** It is the
 * return value of `renderMotifSvg()`, a pure function in our own repository
 * that builds the string from a spec `validateSpec()` has already clamped.
 * Numbers are bounded, colours must match `/^#[0-9a-f]{6}$/`, and every element
 * and attribute in the output is written as a literal in that file — there is
 * no text node, no `foreignObject`, no `href` and no place a prompt could reach.
 * Nothing from a model, a form field or the database is interpolated into it.
 *
 * The alternative — building the same shapes as React elements — would be the
 * same geometry with none of the determinism: the server-rendered thumbnail and
 * the client preview would then come from two different code paths and could
 * drift apart.
 */
export function MotifPreview({
  spec,
  size = 480,
  className,
  label,
}: {
  spec: MotifSpec;
  size?: number;
  className?: string;
  /** Describes the pattern for a screen reader; the SVG itself is aria-hidden. */
  label: string;
}) {
  // Re-rendered only when the spec actually changes, so dragging a slider
  // re-runs the renderer once per committed value rather than once per frame.
  const svg = useMemo(() => renderMotifSvg(spec, size), [spec, size]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        // The SVG is `width="100%"`, but without an explicit block box it
        // still reports an intrinsic width, which sized the grid track and
        // pushed the page past 360px.
        "overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full",
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
