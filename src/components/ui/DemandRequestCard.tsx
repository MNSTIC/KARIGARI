"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  CalendarClock,
  Layers,
  Loader2,
  MapPin,
  Package,
  Palette,
  Ruler,
  Truck,
  Wand2,
} from "lucide-react";
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
  // ---- V9 structured capture. All optional: a demand posted before V9 has
  // none of it, and the card must render those rows exactly as it always did.
  referenceImageUrls?: string[] | null;
  category?: string | null;
  productType?: string | null;
  sizeSpec?: string | null;
  customizationRequired?: boolean | null;
  customizationDetails?: string | null;
  requiredBy?: string | null;
  deliveryMode?: string | null;
  purchaseType?: string | null;
  additionalRequirements?: string | null;
  flexBudget?: string | null;
  flexColor?: string | null;
  flexMaterial?: string | null;
  flexDelivery?: string | null;
  flexDesign?: string | null;
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
  if (demand.sizeSpec) {
    facts.push({ icon: <Ruler size={12} />, label: t("demand_size"), value: demand.sizeSpec });
  }
  if (demand.requiredBy) {
    facts.push({
      icon: <CalendarClock size={12} />,
      label: t("demand_when_needed"),
      value: new Date(demand.requiredBy).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      }),
    });
  }
  if (demand.deliveryMode === "PICKUP") {
    facts.push({
      icon: <Truck size={12} />,
      label: t("demand_delivery_mode"),
      value: t("demand_delivery_pickup"),
    });
  }

  // Only the rows the buyer actually loosened. A matrix of five "Strict" chips
  // is the default and says nothing; the point of showing this at all is to
  // tell the artisan what they are ALLOWED to propose instead.
  const flexible: string[] = [];
  if (demand.flexBudget === "FLEXIBLE") flexible.push(t("demand_flex_budget"));
  if (demand.flexColor === "FLEXIBLE") flexible.push(t("demand_flex_color"));
  if (demand.flexMaterial === "FLEXIBLE") flexible.push(t("demand_flex_material"));
  if (demand.flexDelivery === "FLEXIBLE") flexible.push(t("demand_flex_delivery"));
  if (demand.flexDesign === "SIMILAR") flexible.push(t("demand_flex_design"));

  // The gallery, with the legacy single field as the fallback so a demand
  // posted before V9 still shows its one photo.
  const gallery =
    demand.referenceImageUrls && demand.referenceImageUrls.length > 0
      ? demand.referenceImageUrls
      : [demand.referenceImageUrl].filter((url): url is string => Boolean(url));
  const cover = gallery[0] ?? null;

  const purchaseLabel =
    demand.purchaseType === "BULK"
      ? t("demand_purchase_bulk")
      : demand.purchaseType === "WHOLESALE"
        ? t("demand_purchase_wholesale")
        : null;

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
        {cover ? (
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-lg bg-gray-200",
              compact ? "h-14 w-14" : "h-20 w-20"
            )}
          >
            <Image
              src={cover}
              alt={t("demand_reference_image")}
              fill
              sizes={compact ? "56px" : "80px"}
              unoptimized={cover.startsWith("data:") || cover.startsWith("/api/")}
              className="object-cover"
            />
            {/* How many more the buyer attached. A count, not a carousel: this
                card renders in a 320px notification column as well as on the
                orders page, and a gallery there would bury the list. */}
            {gallery.length > 1 && (
              <span className="absolute bottom-0 right-0 rounded-tl-lg bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                +{gallery.length - 1}
              </span>
            )}
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
            {demand.quantity} × {demand.productType || demand.craftType}
          </p>
          {(demand.category || purchaseLabel) && (
            <p className="mt-0.5 text-[11px] font-medium text-gray-500">
              {[demand.category, purchaseLabel].filter(Boolean).join(" · ")}
            </p>
          )}
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

      {/* Customisation is called out on its own rather than folded into the
          chips: it changes what the artisan is agreeing to make, not just what
          it looks like. */}
      {demand.customizationRequired && (
        <div className="mt-3 rounded-lg border border-[var(--color-sage)] bg-[var(--color-mint)] p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Wand2 size={12} /> {t("demand_customization_required")}
          </p>
          {demand.customizationDetails && (
            <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-primary/85">
              {demand.customizationDetails}
            </p>
          )}
        </div>
      )}

      {flexible.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("demand_flex_heading")}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {flexible.map((name) => (
              <li
                key={name}
                className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* `additionalRequirements` is the V9 field; `notes` is what rows written
          before it carry. Same place on the card either way. */}
      {(demand.additionalRequirements || demand.notes) && (
        <p
          className={cn(
            "mt-3 whitespace-pre-line leading-relaxed text-gray-600",
            compact ? "text-[12px]" : "text-[13px]"
          )}
        >
          {demand.additionalRequirements || demand.notes}
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
