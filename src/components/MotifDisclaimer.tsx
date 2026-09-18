"use client";

import { ShieldAlert } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * What a Karigari motif record is, and the three things it is not.
 *
 * This component is not decoration and it is not a footnote. The motif register
 * is the part of this platform most likely to be misread as a legal claim, so
 * the correction sits on every surface that shows a registration — the artisan's
 * own page, the public record, and the admin review — in the reader's own
 * language, at a size that can be read.
 *
 * The three denials it carries are deliberate and must not be softened:
 *   - it is **not a Geographical Indication**;
 *   - it is **not a legal intellectual-property right**;
 *   - GI registration is granted **only** by the Geographical Indications
 *     Registry, Government of India — not by this app, and not by anyone on it.
 *
 * A unit test asserts those phrases are present in the English string, so a
 * later edit cannot quietly water them down.
 */
export function MotifDisclaimer({
  tone = "card",
  className,
}: {
  /** `card` for a page section, `inline` for a tighter footnote in a list. */
  tone?: "card" | "inline";
  className?: string;
}) {
  const { t } = useLanguage();

  if (tone === "inline") {
    return (
      <p className={cn("text-[11px] leading-relaxed text-gray-500", className)} role="note">
        {t("motif_disclaimer")}
      </p>
    );
  }

  return (
    <aside
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-[var(--color-sage)]/60 bg-[var(--color-mint)]/40 px-4 py-3",
        className
      )}
    >
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--color-maroon)]" aria-hidden />
      <p className="text-[13px] leading-relaxed text-gray-700">{t("motif_disclaimer")}</p>
    </aside>
  );
}
