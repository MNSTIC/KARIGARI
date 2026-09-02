"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, Palette, Layers, MapPin, Package } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * What the buyer actually asked for, shown to the artisan **before** they
 * accept.
 *
 * A demand alert only carries a `relatedDemandId`, so this fetches the row and
 * renders the parts a maker needs to judge the job: the reference photo, the
 * material and colour, the buyer's own words, the quantity and the price band.
 * Without it the artisan is agreeing to "40 sarees" and finding out what kind
 * afterwards.
 *
 * The fetch is per-mount and cached at module level, because the same demand is
 * commonly opened from both the bell and the notifications page in one session.
 */

export interface DemandDetail {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
  notes: string | null;
  referenceImageUrl: string | null;
  material: string | null;
  color: string | null;
  description: string | null;
  matchScore: number | null;
}

const cache = new Map<string, DemandDetail>();

export function useDemandDetail(demandId: string | null | undefined) {
  const [demand, setDemand] = useState<DemandDetail | null>(
    demandId ? (cache.get(demandId) ?? null) : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!demandId || cache.has(demandId)) return;
    let cancelled = false;
    // Everything, the spinner included, is deferred a macrotask so the effect
    // body performs no synchronous setState — the same kickoff pattern the rest
    // of the app uses.
    const kickoff = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/demand?id=${encodeURIComponent(demandId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && data.demand) {
          cache.set(demandId, data.demand as DemandDetail);
          setDemand(data.demand as DemandDetail);
        }
      } catch (error) {
        console.warn("Could not load the buyer request:", (error as Error)?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, [demandId]);

  return { demand, loading };
}

function priceBand(demand: DemandDetail): string | null {
  const { targetPriceMin: min, targetPriceMax: max } = demand;
  if (min !== null && max !== null) return `${formatRupees(min)} – ${formatRupees(max)}`;
  if (max !== null) return `≤ ${formatRupees(max)}`;
  if (min !== null) return `≥ ${formatRupees(min)}`;
  return null;
}

export function DemandRequestCard({
  demandId,
  compact = false,
  className,
}: {
  demandId: string;
  /** Tighter spacing for the notification dropdown's 320px column. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const { demand, loading } = useDemandDetail(demandId);

  if (loading && !demand) {
    return (
      <div className={cn("flex items-center gap-2 py-3 text-xs text-gray-500", className)}>
        <Loader2 size={13} className="animate-spin" />
      </div>
    );
  }
  if (!demand) return null;

  const band = priceBand(demand);
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (demand.material) {
    facts.push({ icon: <Layers size={12} />, label: t("demand_material"), value: demand.material });
  }
  if (demand.color) {
    facts.push({ icon: <Palette size={12} />, label: t("demand_color"), value: demand.color });
  }
  if (demand.location) {
    facts.push({ icon: <MapPin size={12} />, label: t("demand_location"), value: demand.location });
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-[var(--color-gray-100)]",
        compact ? "p-3" : "p-4",
        className
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {t("demand_specifics")}
      </p>

      <div className={cn("mt-2.5 flex gap-3", compact && "gap-2.5")}>
        {/* Guarded: a demand posted without a photo must render no <Image> at
            all, not one with an empty src. */}
        {demand.referenceImageUrl ? (
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-lg bg-gray-200",
              compact ? "h-14 w-14" : "h-20 w-20"
            )}
          >
            <Image
              src={demand.referenceImageUrl}
              alt={t("demand_reference_image")}
              fill
              sizes={compact ? "56px" : "80px"}
              unoptimized={demand.referenceImageUrl.startsWith("data:")}
              className="object-cover"
            />
          </div>
        ) : (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg bg-gray-200/70 text-gray-400",
              compact ? "h-14 w-14" : "h-20 w-20"
            )}
          >
            <Package size={compact ? 16 : 22} strokeWidth={1.5} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className={cn("font-bold text-gray-900", compact ? "text-[13px]" : "text-sm")}>
            {demand.quantity} × {demand.craftType}
          </p>
          {band && <p className="mt-0.5 text-xs font-medium text-gray-600">{band}</p>}

          {facts.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {facts.map((fact) => (
                <li
                  key={fact.label}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-700"
                >
                  <span className="text-gray-400">{fact.icon}</span>
                  {fact.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {demand.description && (
        <p
          className={cn(
            "mt-3 whitespace-pre-line leading-relaxed text-gray-700",
            compact ? "text-[12px]" : "text-[13px]"
          )}
        >
          {demand.description}
        </p>
      )}

      {/* The stored score does not record HOW it was reached — a reference
          photo is only scored visually when the model is actually reachable,
          and it often is not. So the card reports the number and stops there;
          the method is named on the buyer's match panel, which has the live
          `scoredBy` from the response. */}
      {demand.matchScore !== null && demand.matchScore !== undefined && (
        <p className="mt-3 border-t border-gray-200 pt-2.5 text-[11px] text-gray-500">
          {t("demand_match_confidence")}:{" "}
          <strong className="font-bold text-gray-800">
            {Math.round(demand.matchScore * 100)}%
          </strong>
        </p>
      )}
    </div>
  );
}
