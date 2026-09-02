"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Package } from "lucide-react";
import { imageProps, marketPrice, type MarketItem } from "@/lib/marketplace";
import { formatRupees } from "@/lib/pricing";

/**
 * An infinite horizontal marquee of all listed craft items.
 *
 * The track duplicates the item list so the scroll loops seamlessly. CSS
 * `@keyframes` drives the motion at a constant rate; `:hover` pauses it.
 * Each card shows a hover overlay with the craft name, artisan, and origin.
 */
export function HeritageMarquee({ items }: { items: MarketItem[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // Ensure we have enough items to fill a wide screen in a single track
  let displayItems = [...items];
  while (displayItems.length < 8) {
    displayItems = [...displayItems, ...items];
  }

  // Faster scroll speed (2 seconds per item instead of 5)
  const baseDuration = Math.max(displayItems.length * 2.5, 20);

  return (
    <div
      className="relative pb-16 sm:pb-20"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Fade edges */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-16 sm:w-24 z-10 bg-gradient-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 sm:w-24 z-10 bg-gradient-to-l from-white to-transparent" />

      <div className="overflow-hidden flex">
        {/* Track 1 */}
        <div
          className="flex gap-5 shrink-0 pr-5 will-change-transform"
          style={{
            animation: `heritage-scroll ${baseDuration}s linear infinite`,
            animationPlayState: paused ? "paused" : "running",
          }}
        >
          {displayItems.map((item, i) => (
            <MarqueeCard key={`t1-${item.id}-${i}`} item={item} />
          ))}
        </div>
        
        {/* Track 2 (Identical) */}
        <div
          className="flex gap-5 shrink-0 pr-5 will-change-transform"
          aria-hidden="true"
          style={{
            animation: `heritage-scroll ${baseDuration}s linear infinite`,
            animationPlayState: paused ? "paused" : "running",
          }}
        >
          {displayItems.map((item, i) => (
            <MarqueeCard key={`t2-${item.id}-${i}`} item={item} />
          ))}
        </div>
      </div>

      {/* Keyframe injected once */}
      <style>{`
        @keyframes heritage-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}

function MarqueeCard({ item }: { item: MarketItem }) {
  const [hovered, setHovered] = useState(false);
  const price = marketPrice(item);
  const region = item.artisan.location || item.artisan.clusterName;

  return (
    <Link
      href={`/marketplace/product/${item.id}`}
      className="group relative shrink-0 w-[240px] sm:w-[260px] block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Image */}
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[var(--color-pill)]">
        {item.images?.[0] ? (
          <Image
            {...imageProps(item.images[0])}
            fill
            alt={item.craftType}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            sizes="260px"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-gray-400">
            <Package size={36} strokeWidth={1.4} />
          </span>
        )}

        {/* Hover overlay */}
        <div
          className="absolute inset-0 rounded-2xl flex flex-col justify-end p-4 transition-opacity duration-300"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)",
            opacity: hovered ? 1 : 0,
          }}
        >
          <h3 className="kg-display text-[16px] leading-snug text-white">
            {item.craftType}
          </h3>
          {price !== null && (
            <span className="text-[14px] text-white/80 mt-0.5">{formatRupees(price)}</span>
          )}
          <p className="text-[12px] text-white/70 mt-1.5 leading-snug">
            <span className="text-white/90">Artisan:</span> {item.artisan.name}
          </p>
          {region && (
            <p className="text-[11px] text-white/60 mt-0.5">
              {region}
            </p>
          )}
        </div>
      </div>

      {/* Below-image label — always visible */}
      <div className="mt-3 px-0.5">
        <h3 className="kg-display text-[15px] leading-snug text-gray-900 truncate">
          {item.craftType}
        </h3>
        <p className="text-[12px] text-gray-500 mt-0.5 truncate">
          {item.artisan.name}
          {region && <span className="text-gray-400"> · {region}</span>}
        </p>
      </div>
    </Link>
  );
}
