"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";

/**
 * The verification result card the buyer sees after a scan.
 *
 * Lives here rather than inside `BuyerOrders.tsx` because two surfaces render
 * it — the demand-scoped verify form in My Orders, and the standalone
 * `/buyer/verify` scan page. Duplicating it would let the two drift on exactly
 * the screen where a buyer decides whether to trust a delivery.
 */

export interface BuyerVerifyResultShape {
  patchIdValid: boolean;
  productMatch: boolean;
  artisanMatch: boolean;
  /** Only meaningful when `qrChecked` — a typed code auto-passes. */
  qrValid: boolean;
  /** Whether a QR was involved at all. Drives whether the 4th row renders. */
  qrChecked: boolean;
  similarityScore: number;
  reasoning: string;
  artisanName: string | null;
}

/** Every check that actually applies to this attempt passed. */
export function isFullyVerified(result: BuyerVerifyResultShape): boolean {
  return (
    result.patchIdValid &&
    result.productMatch &&
    result.artisanMatch &&
    (!result.qrChecked || result.qrValid)
  );
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

export function BuyerVerifyResult({
  result,
  patchId,
  t,
}: {
  result: BuyerVerifyResultShape;
  patchId: string;
  t: (key: string) => string;
}) {
  const allGood = isFullyVerified(result);

  return (
    <div
      className={[
        "rounded-xl border p-4",
        allGood ? "border-[var(--color-sage)] bg-[var(--color-mint)]" : "border-red-200 bg-red-50",
      ].join(" ")}
    >
      <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
        <ShieldCheck size={16} className={allGood ? "text-primary" : "text-red-600"} />
        {t("verification_results")}
      </h4>

      <div className="space-y-2">
        <Row ok={result.patchIdValid} label={t("patch_id_valid")} value={patchId || undefined} />
        <Row
          ok={result.productMatch}
          label={t("product_match")}
          value={`${result.similarityScore}%`}
        />
        <Row
          ok={result.artisanMatch}
          label={t("artisan_match")}
          value={result.artisanName || undefined}
        />
        {/* Fourth row only when a QR was actually scanned — a hand-typed code
            has nothing to cross-check against. */}
        {result.qrChecked && <Row ok={result.qrValid} label={t("qr_match")} />}
      </div>

      <p
        className={[
          "mt-3 text-xs leading-relaxed",
          allGood ? "text-primary/80" : "text-red-700",
        ].join(" ")}
      >
        {allGood ? t("product_genuine") : t("verification_failed")}
        {result.reasoning ? ` — ${result.reasoning}` : ""}
      </p>
    </div>
  );
}
