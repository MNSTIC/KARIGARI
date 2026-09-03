"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";

/**
 * The live "does this demand make sense?" panel inside PostDemandModal.
 *
 * Fires a debounced POST to /api/demand/recommend as the buyer types. Rendered
 * inline in the form — same green-mint card family as the fair-wage panel on
 * the artisan side — because a warning that reaches the buyer BEFORE they hit
 * Post New Demand is worth a hundred flagged rows in the facilitator queue.
 *
 * States: idle (waits for the mandatory fields) → analyzing → result. Falls
 * back silently: if the API rejects, the panel disappears and the form still
 * submits.
 */
interface Props {
  craftType: string;
  quantity: number;
  targetPriceMin?: number;
  targetPriceMax?: number;
  material: string;
  color: string;
  description: string;
}

type Verdict = {
  status: "good" | "low_price" | "suggestion";
  message: string;
  estimatedFairPrice: number;
  suggestedMaterials?: string[];
};

export function DemandRecommendation({
  craftType,
  quantity,
  targetPriceMin,
  targetPriceMax,
  material,
  color,
  description,
}: Props) {
  const { t } = useLanguage();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(false);
  // Held in a ref rather than state: an aborted request must NOT re-render.
  const abortRef = useRef<AbortController | null>(null);

  // Mandatory-fields gate: craftType + quantity + at least one price.
  const ready =
    craftType.trim().length >= 3 &&
    quantity > 0 &&
    (Boolean(targetPriceMin) || Boolean(targetPriceMax));

  useEffect(() => {
    if (!ready) {
      // No setState here — the render branch below early-returns on `!ready`,
      // so the previous verdict simply disappears with the panel rather than
      // being reset synchronously in the effect body (which the react-hooks
      // "cascading render" rule forbids).
      abortRef.current?.abort();
      return;
    }

    // 1s debounce — long enough that a still-typing buyer does not fire a
    // request per keystroke, short enough that a settled form feels live.
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      try {
        const res = await fetch("/api/demand/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            craftType,
            quantity,
            targetPriceMin,
            targetPriceMax,
            material,
            color,
            description,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!controller.signal.aborted && data?.success) {
          setVerdict({
            status: data.status,
            message: data.message,
            estimatedFairPrice: data.estimatedFairPrice,
            suggestedMaterials: data.suggestedMaterials,
          });
        } else if (!controller.signal.aborted) {
          setVerdict(null);
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") {
          console.warn("Demand recommend failed:", error);
          setVerdict(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 1000);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [ready, craftType, quantity, targetPriceMin, targetPriceMax, material, color, description]);

  // Panel disappears when the form is no longer valid — no effect-side reset
  // needed; the next `ready` fetch will overwrite whatever verdict was last.
  if (!ready) return null;

  const good = verdict?.status === "good";
  const Icon = loading ? Sparkles : good ? CheckCircle2 : AlertTriangle;

  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (good
          ? "border-[var(--color-sage)]/60 bg-[var(--color-mint)]"
          : verdict
            ? "border-amber-200 bg-amber-50"
            : "border-[var(--color-sage)]/50 bg-[var(--color-mint)]")
      }
      aria-live="polite"
    >
      <h4 className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary">
        {loading ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Icon size={13} className={good ? "text-primary" : "text-amber-700"} />
        )}
        {t("demand_ai_recommendation")}
      </h4>

      {loading ? (
        <p className="text-[13px] leading-relaxed text-primary/80">{t("demand_ai_analyzing")}</p>
      ) : verdict ? (
        <>
          <p
            className={
              "text-[13px] leading-relaxed " +
              (good ? "text-primary/85" : "text-amber-900")
            }
          >
            {verdict.message}
          </p>

          {verdict.suggestedMaterials?.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                {t("demand_ai_alternative_materials")}
              </span>
              {verdict.suggestedMaterials.map((option) => (
                <span
                  key={option}
                  className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-amber-900 border border-amber-200"
                >
                  {option}
                </span>
              ))}
            </div>
          ) : null}

          {!good && verdict.estimatedFairPrice > 0 ? (
            <p className="mt-2 text-[11px] font-medium text-amber-800">
              {t("demand_ai_estimated_fair_price")}: {formatRupees(verdict.estimatedFairPrice)}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
