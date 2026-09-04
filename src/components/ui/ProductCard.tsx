"use client";

import Image from "next/image";
import Link from "next/link";
import { Package } from "lucide-react";
import { VerifiedOriginBadge } from "@/components/ui/Badge";
import { StarRating } from "@/components/ui/StarRating";
import { artisanSharePctFor } from "@/lib/escrow";
import { imageProps, marketPrice, type MarketItem } from "@/lib/marketplace";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * One craft in the marketplace grid.
 *
 * Three things on this card are deliberate departures from the mockup it is
 * drawn from:
 *
 *  - The provenance badge says **Verified Origin**, not "GI TAGGED". GI claims
 *    were removed from the product earlier and stay removed; what Karigari can
 *    actually attest to is that the piece carries a patch ID which was matched
 *    against a re-photograph.
 *  - The ID chip is the item's real `patchId`, and it only renders when the
 *    item has one.
 *  - **Artisan Share** is computed per item from `@/lib/escrow`, not printed as
 *    a fixed 89.36%. It is the same arithmetic the settlement engine runs.
 */
export function ProductCard({
  item,
  href,
  className,
}: {
  item: MarketItem;
  href?: string;
  className?: string;
}) {
  const price = marketPrice(item);
  const share = artisanSharePctFor(price);
  const region = item.artisan.location || item.artisan.clusterName;
  // Aggregate rating comes from /api/items/market; a card with no reviews yet
  // shows no stars rather than a hollow row of five zeros.
  const avgRating = item.avgRating ?? null;
  const reviewCount = item.reviewCount ?? 0;

  return (
    <Link
      href={href ?? `/marketplace/product/${item.id}`}
      className={cn("group flex flex-col", className)}
    >
      {/* Fixed aspect box rather than a fixed height: photos decode at
          different times and a percentage height makes the grid jump. */}
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-[var(--color-pill)]">
        {item.images?.[0] ? (
          <Image
            {...imageProps(item.images[0])}
            fill
            alt={item.craftType}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-gray-400">
            <Package size={36} strokeWidth={1.4} />
          </span>
        )}

        {item.verified && <VerifiedOriginBadge className="absolute left-3 top-3" />}
      </div>

      <div className="flex flex-1 flex-col pt-4">
        {/* Title and price share a row but never collide: the title is allowed
            to wrap inside a min-w-0 column and the price is a shrink-0 column
            aligned to the first line's baseline. */}
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="kg-display min-w-0 text-[19px] leading-tight text-gray-900">
            {item.craftType}
          </h3>
          <span className="kg-display shrink-0 text-[19px] leading-tight text-gray-900">
            {formatRupees(price)}
          </span>
        </div>

        {avgRating !== null && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <StarRating rating={avgRating} size={12} />
            <span className="text-[11px] font-medium text-gray-500">
              {avgRating.toFixed(1)} · {reviewCount}
            </span>
          </div>
        )}

        <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
          <span className="text-gray-600">Artisan:</span> {item.artisan.name}
          {region && (
            <>
              <span aria-hidden className="px-1.5 text-gray-300">
                •
              </span>
              {region}
            </>
          )}
        </p>

        {/* The raw patch ID is a private unique identifier — shown only to the
            artisan who made the piece and the buyer who bought it, never on the
            public marketplace. Here we surface only whether the piece carries a
            verified origin, not the ID itself. */}
        <div className="mt-auto border-t border-gray-200/80 pt-3.5">
          <p className="kg-label font-medium text-[var(--color-rust)]">
            Artisan Share: {share.toFixed(2)}%
          </p>
          <p
            className={cn(
              "kg-label mt-1.5",
              item.verified ? "font-medium text-[var(--color-primary)]" : "text-gray-300"
            )}
          >
            {item.verified ? "Verified origin" : "Awaiting verification"}
          </p>
        </div>
      </div>
    </Link>
  );
}
