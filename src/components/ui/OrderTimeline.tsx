"use client";

import Image from "next/image";
import {
  CheckCircle2,
  Factory,
  Handshake,
  Package,
  ScanLine,
  Truck,
} from "lucide-react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ORDER_STAGES, ORDER_STAGE_KEYS, stageIndex, type OrderStage } from "@/lib/orderStage";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The buyer-facing production timeline.
 *
 * Horizontal on desktop, vertical on a phone — the same ladder either way,
 * built on the app's own `ProgressBar` primitive rather than a chart library.
 * Completed stages are filled charcoal, the current one is ringed, and
 * everything ahead is muted; nothing is ever shown as reached on a guess.
 */

const STAGE_ICONS: Record<OrderStage, React.ReactNode> = {
  PLACED: <Package size={14} />,
  ACCEPTED: <Handshake size={14} />,
  IN_PRODUCTION: <Factory size={14} />,
  QUALITY_CHECK: <ScanLine size={14} />,
  DISPATCHED: <Truck size={14} />,
  DELIVERED: <CheckCircle2 size={14} />,
};

export interface TrackedItem {
  id: string;
  craftType: string;
  patchId: string | null;
  image: string | null;
  artisanName: string;
  stage: OrderStage;
  stageAt: string;
  createdAt: string;
  estimatedDeliveryAt: string | null;
  price: number | null;
}

export interface TrackPayload {
  requested: number;
  fulfilled: number;
  acceptedByArtisan: boolean;
  items: TrackedItem[];
  rate: { perDay: number; days: number } | null;
  projectedCompletion: string | null;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/** One item's ladder. */
function StageLadder({ current }: { current: OrderStage }) {
  const { t } = useLanguage();
  const reached = stageIndex(current);

  return (
    <>
      {/* Desktop: a horizontal rail with the connector drawn between nodes. */}
      <ol className="hidden sm:flex sm:items-start sm:justify-between sm:gap-1">
        {ORDER_STAGES.map((stage, index) => {
          const done = index < reached;
          const active = index === reached;
          return (
            <li key={stage} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-1/2 top-[13px] h-[2px] w-full",
                    index <= reached ? "bg-primary" : "bg-gray-200"
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border",
                  done && "border-transparent bg-primary text-white",
                  active && "border-primary bg-[var(--color-mint)] text-primary",
                  !done && !active && "border-gray-200 bg-white text-gray-300"
                )}
              >
                {STAGE_ICONS[stage]}
              </span>
              <span
                className={cn(
                  "mt-2 text-center text-[10px] font-bold uppercase leading-tight tracking-wider",
                  index <= reached ? "text-gray-800" : "text-gray-400"
                )}
              >
                {t(ORDER_STAGE_KEYS[stage])}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Phone: the same ladder turned on its side, so six labels never have to
          share a 360px row. */}
      <ol className="sm:hidden">
        {ORDER_STAGES.map((stage, index) => {
          const done = index < reached;
          const active = index === reached;
          return (
            <li key={stage} className="relative flex gap-3 pb-4 last:pb-0">
              {index < ORDER_STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-[2px]",
                    index < reached ? "bg-primary" : "bg-gray-200"
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                  done && "border-transparent bg-primary text-white",
                  active && "border-primary bg-[var(--color-mint)] text-primary",
                  !done && !active && "border-gray-200 bg-white text-gray-300"
                )}
              >
                {STAGE_ICONS[stage]}
              </span>
              <span
                className={cn(
                  "pt-1 text-[12px] font-bold uppercase tracking-wider",
                  index <= reached ? "text-gray-800" : "text-gray-400"
                )}
              >
                {t(ORDER_STAGE_KEYS[stage])}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function OrderTimeline({ data }: { data: TrackPayload }) {
  const { t } = useLanguage();
  const bulk = data.requested > 1;

  if (data.items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        {t("track_nothing_yet")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ bulk fulfilment */}
      {bulk && (
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              {t("track_bulk_heading")}
            </h4>
            <p className="text-sm font-bold text-gray-900">
              {t("track_units_fulfilled")
                .replace("{done}", String(data.fulfilled))
                .replace("{total}", String(data.requested))}
            </p>
          </div>

          <ProgressBar
            value={data.fulfilled}
            max={data.requested}
            label={t("track_bulk_heading")}
            className="mt-3"
          />

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
            <span>
              {data.rate
                ? t("track_rate").replace("{rate}", data.rate.perDay.toFixed(2))
                : t("track_rate_unknown")}
            </span>
            {data.projectedCompletion && (
              <span>
                {t("track_projected").replace("{date}", shortDate(data.projectedCompletion))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ per-piece ladder */}
      {data.items.map((item) => (
        <div key={item.id} className="rounded-2xl bg-white p-5 shadow-card">
          <div className="mb-5 flex items-center gap-3">
            {/* Guarded: a piece with no photo renders the placeholder, never an
                <Image> with an empty src. */}
            {item.image ? (
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                <Image
                  src={item.image}
                  alt=""
                  fill
                  sizes="44px"
                  unoptimized={item.image.startsWith("data:")}
                  className="object-cover"
                />
              </div>
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                <Package size={17} />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-900">{item.craftType}</p>
              <p className="truncate text-xs text-gray-500">
                {item.artisanName}
                {item.patchId && (
                  <span className="ml-2 font-mono text-[10px] text-gray-400">{item.patchId}</span>
                )}
              </p>
            </div>

            <div className="shrink-0 text-right">
              {item.price !== null && (
                <p className="text-sm font-bold text-gray-900">{formatRupees(item.price)}</p>
              )}
              <p className="text-[10px] font-medium text-gray-400">{shortDate(item.stageAt)}</p>
            </div>
          </div>

          <StageLadder current={item.stage} />
        </div>
      ))}
    </div>
  );
}
