"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  CheckCircle2,
  Globe,
  Info,
  MapPin,
  Package,
  ShieldCheck,
  X,
} from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { formatRupees } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";
import { imageProps, marketPrice, type MarketItem } from "@/lib/marketplace";

/**
 * The public consumer storefront.
 *
 * Every card is a real `CraftItem` an artisan has published. Buying goes
 * straight to Stripe test checkout, and the escrow that follows pays the
 * artisan's own VPA — there is no middleman account in between.
 */

export default function MarketplacePage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [paymentBanner, setPaymentBanner] = useState<"success" | "cancelled" | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/items/market?listed=1", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        // The route already filters, but the storefront never renders an
        // unpublished row even if the filter is dropped upstream.
        setItems((data.items || []).filter((item: MarketItem) => item.isListedOnMarketplace));
      } else {
        setLoadFailed(true);
      }
    } catch (error) {
      console.error("Failed to load the marketplace:", error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the market and buyer pages use.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  // Read the Stripe return straight off the URL rather than via useSearchParams,
  // so this fully-client page needs no Suspense boundary — the pattern the
  // artisan dashboard already uses.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const payment = params.get("payment");
      if (payment !== "success" && payment !== "cancelled") return;
      setPaymentBanner(payment);
      params.delete("payment");
      params.delete("session_id");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-16">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        <KarigariLogo variant="dark" showWordmark={true} size={28} />
        <div className="ml-auto flex items-center gap-4">
          {/* A shopper has no account here, so the switcher has to be reachable
              from the storefront itself. */}
          <LanguageSwitcher />
          <Link
            href="/login"
            className="text-sm font-bold text-primary hover:text-primary-dark transition-colors whitespace-nowrap"
          >
            {t('artisan_login')}
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {paymentBanner === "success" && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-4 sm:p-5">
            <CheckCircle2 size={20} className="shrink-0 mt-0.5 text-primary" />
            <div className="text-sm text-primary">
              <p className="font-bold">{t('payment_success_title')}</p>
              <p className="mt-1 leading-relaxed text-primary/80">
                {t('payment_success_body')}
              </p>
            </div>
            <button
              onClick={() => setPaymentBanner(null)}
              aria-label={t('dismiss')}
              className="ml-auto p-1 text-primary/60 hover:text-primary transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {paymentBanner === "cancelled" && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-gray-200 bg-card p-4 sm:p-5">
            <Info size={20} className="shrink-0 mt-0.5 text-gray-400" />
            <p className="text-sm text-gray-600">{t('payment_cancelled')}</p>
            <button
              onClick={() => setPaymentBanner(null)}
              aria-label={t('dismiss')}
              className="ml-auto p-1 text-gray-400 hover:text-gray-700 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-primary flex items-center gap-3">
            <Globe size={28} className="text-primary-light" />
            {t('nav_marketplace')}
          </h1>
          <p className="text-gray-600 mt-2 text-sm sm:text-base max-w-2xl leading-relaxed">
            {t('marketplace_subtitle')}
          </p>
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-primary bg-[var(--color-mint)]/60 border border-[var(--color-sage)]/50 rounded-xl p-3 flex gap-2 items-start leading-relaxed">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            {t('mp_escrow_note')}
          </p>
          <p className="text-xs text-gray-500 bg-card border border-gray-200 rounded-xl p-3 flex gap-2 items-start leading-relaxed">
            <Info size={14} className="shrink-0 mt-0.5 text-gray-400" />
            {t('mp_prototype_note')}
          </p>
        </div>

        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : loadFailed ? (
          <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
            {t('mp_load_failed')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
            {t('mp_empty')}
          </p>
        ) : (
          <>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
              {items.length} {t('pieces_live')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {items.map((item) => (
                <ProductCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ProductCard({ item }: { item: MarketItem }) {
  const { t } = useLanguage();
  const price = marketPrice(item);

  return (
    <Link
      href={`/marketplace/product/${item.id}`}
      className="bg-card rounded-2xl border border-gray-100 shadow-card overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all"
    >
      <div className="h-52 bg-gray-100 relative">
        {item.images?.[0] ? (
          <Image
            {...imageProps(item.images[0])}
            fill
            alt={item.craftType}
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <Package size={40} />
          </div>
        )}
        {item.patchId && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-primary text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm">
            <CheckCircle2 size={11} /> {t('verified')}
          </span>
        )}
      </div>

      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-serif font-bold text-lg text-primary mb-1">{item.craftType}</h3>
        <p className="text-xs text-gray-500 font-medium flex items-center gap-1 mb-3">
          <MapPin size={11} /> {item.artisan.clusterName} · {item.artisan.name}
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {item.isOndcLive && (
            <span className="bg-[var(--color-mint)] text-primary text-[10px] font-bold px-2 py-1 rounded-md">
              ONDC
            </span>
          )}
          {item.artisan.giTagCertified && (
            <span className="bg-[var(--color-mint)] text-primary text-[10px] font-bold px-2 py-1 rounded-md">
              GI Tag
            </span>
          )}
        </div>

        <div className="mt-auto pt-4 border-t border-gray-100 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('price_label')}</p>
            <p className="text-xl font-serif font-bold text-primary">{formatRupees(price)}</p>
          </div>
          <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-primary text-white">
            View
          </span>
        </div>
      </div>
    </Link>
  );
}
