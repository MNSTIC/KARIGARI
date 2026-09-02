import React from "react";
import { cn } from "@/lib/utils";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";

export { PageTitle, PageLede, SectionHeading, SectionEyebrow } from "@/components/ui/SectionEyebrow";

/**
 * The eyebrow-with-an-action row.
 *
 * Kept as its own export because a dozen pages already import `SectionLabel`;
 * the styling now comes from `SectionEyebrow` so there is one definition of
 * what a tracked label looks like.
 */
export function SectionLabel({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  /** Optional right-aligned affordance ("View All", a filter icon). */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3 mb-3", className)}>
      <SectionEyebrow as="h2">{children}</SectionEyebrow>
      {action}
    </div>
  );
}
