"use client";

import Image from "next/image";
import Link from "next/link";
import { Package } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { SectionHeading } from "@/components/ui/SectionEyebrow";
import type { PassportCard } from "@/lib/passport";
import { fill } from "@/components/buyer/passportFormat";

/**
 * Up to six other pieces by the same artisan that a buyer could actually buy
 * right now — the storefront's own PURCHASABLE_WHERE rule, applied on the
 * server. Renders nothing at all when there are none.
 */
export function MoreFromArtisan({ items, artisanName }: { items: PassportCard[]; artisanName: string }) {
  const { t } = useLanguage();
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="passport-more">
      <SectionHeading id="passport-more" size="sm">
        {t("more_from_artisan")}
      </SectionHeading>
      <p className="-mt-1 mb-3 text-[13px] text-gray-500">{fill(t("more_from_artisan_by"), { name: artisanName })}</p>
      <ul className="kg-rail -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {items.map((item) => (
          <li key={item.id} className="w-[168px] shrink-0 snap-start">
            <Link href={`/marketplace/product/${item.id}`} className="kg-lift block rounded-2xl border border-gray-200/70 bg-card p-2 shadow-card">
              <div className="relative aspect-square overflow-hidden rounded-xl bg-[var(--color-pill)]">
                {item.image ? (
                  <Image src={item.image.thumb} unoptimized={item.image.unoptimized} alt="" fill sizes="168px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-gray-400">
                    <Package size={28} aria-hidden />
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5rem] px-1 text-[13px] font-medium leading-tight text-gray-900">{item.craftType}</p>
              <p className="px-1 pb-1 pt-1 text-[13px] text-gray-600">{item.price !== null ? formatRupees(item.price) : t("price_not_set")}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
