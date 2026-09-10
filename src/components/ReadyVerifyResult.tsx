"use client";

import { CheckCircle2, ShieldCheck, Sparkles, XCircle } from "lucide-react";

/**
 * What the artisan sees after their own ready-check.
 *
 * A sibling of `BuyerVerifyResult` rather than a reuse of it: that card renders
 * the BUYER's four checks (patch resolves, product matches, artisan owns the
 * order, QR agrees), and this one renders a different set — the patch is the
 * artisan's own piece, and the photo matches its original capture. Forcing one
 * component to cover both would mean a row that means something different
 * depending on who is looking at it.
 *
 * The visual language is deliberately identical: mint on pass, red on fail,
 * checks stacked with the score right-aligned. The artisan and the buyer are
 * looking at the same question, and it should look like the same question.
 */

export interface ReadyVerifyOutcome {
  passed: boolean;
  similarityScore: number;
  threshold: number;
  reasoning: string;
  /**
   * Which path produced the score. 'fallback' means Gemini never ran, so the
   * number is a stand-in and the card says so rather than presenting it as a
   * judgement the model made.
   */
  scoredBy: "gemini" | "fallback" | null;
  patchId: string;
}

function Row({ ok, label, value }: { ok: boolean; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 size={16} className="shrink-0 text-primary" />
      ) : (
        <XCircle size={16} className="shrink-0 text-red-500" />
      )}
      <span className="font-bold text-gray-900">{label}</span>
      {value && <span className="ml-auto text-xs font-medium text-gray-500">{value}</span>}
    </div>
  );
}

export function ReadyVerifyResult({
  result,
  t,
}: {
  result: ReadyVerifyOutcome;
  t: (key: string) => string;
}) {
  const { passed } = result;

  return (
    <div
      className={[
        "rounded-xl border p-4",
        passed ? "border-[var(--color-sage)] bg-[var(--color-mint)]" : "border-red-200 bg-red-50",
      ].join(" ")}
      aria-live="polite"
    >
      <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
        <ShieldCheck size={16} className={passed ? "text-primary" : "text-red-600"} />
        {t("ready_verify_results")}
      </h4>

      <div className="space-y-2">
        <Row ok label={t("ready_patch_matched")} value={result.patchId || undefined} />
        <Row
          ok={passed}
          label={t("ready_photo_matched")}
          value={`${result.similarityScore}% / ${result.threshold}%`}
        />
      </div>

      <p
        className={[
          "mt-3 text-xs leading-relaxed",
          passed ? "text-primary/80" : "text-red-700",
        ].join(" ")}
      >
        {passed ? t("ready_verify_passed") : t("ready_verify_failed")}
        {result.reasoning ? ` — ${result.reasoning}` : ""}
      </p>

      {/* The score came from nowhere, and saying so is the whole rule. Without
          this line a 98 produced by an exhausted quota reads exactly like a 98
          the model arrived at. */}
      {result.scoredBy === "fallback" && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600">
          <Sparkles size={12} className="mt-0.5 shrink-0" />
          {t("ready_verify_fallback_note")}
        </p>
      )}
    </div>
  );
}
