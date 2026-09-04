"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { ArrowRight, HandCoins, MapPin, ShieldCheck, TrendingUp } from "lucide-react";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { HeritageMarquee } from "@/components/HeritageMarquee";
import { ARTISAN_TOTAL_RATE } from "@/lib/escrow";
import { locateCity } from "@/lib/indiaGeo";
import { marketPrice, type MarketItem } from "@/lib/marketplace";
import { useLanguage } from "@/lib/translations";

/**
 * The public front door.
 *
 * Everything with a number on it is real. The stats strip counts the live
 * marketplace rather than printing the mockup's "$2M+", the Curated Heritage
 * row is the actual listed `CraftItem`s, and the map pins the clusters those
 * items were made in. When nothing is listed yet the sections say so instead of
 * rendering invented rows.
 */

/* The demand map uses Leaflet which requires the window object, so we load it
   dynamically only on the client. */
const DemandMap = dynamic(() => import("@/components/DemandMap"), {
  ssr: false,
  loading: () => <div className="kg-shimmer aspect-video w-full rounded-2xl" />,
});

export default function LandingPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/items/market?listed=1", { cache: "no-store" });
        const data = await res.json();
        if (data?.success) {
          setItems((data.items || []).filter((item: MarketItem) => item.isListedOnMarketplace));
        }
      } catch (error) {
        console.error("Failed to load the marketplace preview:", error);
      } finally {
        setLoaded(true);
      }
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  /** Live platform figures, derived from the public feed. Nothing invented. */
  const stats = useMemo(() => {
    const artisans = new Set(items.map((item) => item.artisan.id));
    const clusters = new Set(
      items.map((item) => item.artisan.location || item.artisan.clusterName).filter(Boolean)
    );
    const verified = items.filter((item) => item.verified).length;
    return [
      { value: String(items.length), label: "Pieces listed" },
      { value: String(artisans.size), label: "Verified artisans" },
      { value: String(clusters.size), label: "Craft clusters" },
      { value: `${(ARTISAN_TOTAL_RATE * 100).toFixed(2)}%`, label: "Direct to artisan" },
      { value: String(verified), label: "Patch-verified pieces" },
    ].slice(0, 4);
  }, [items]);

  /**
   * One map pin per cluster that actually has something listed, grouped the way
   * DemandMap expects. Locations the gazetteer cannot resolve are dropped
   * rather than pinned somewhere invented.
   */
  const clusters = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; lat: number; lon: number; location: string; mine: boolean; fresh: boolean; totalQuantity: number; demands: { id: string; craftType: string; quantity: number; targetPriceMin: number | null; targetPriceMax: number | null; buyerName: string | null }[] }
    >();

    for (const item of items) {
      const place = item.artisan.location || item.artisan.clusterName;
      if (!place) continue;
      const point = locateCity(place);
      if (!point) continue;

      const key = place.toLowerCase();
      const group =
        groups.get(key) ??
        {
          id: key,
          lat: point.lat,
          lon: point.lon,
          location: place,
          mine: false,
          fresh: false,
          totalQuantity: 0,
          demands: [],
        };
      const price = marketPrice(item);
      group.totalQuantity += 1;
      group.demands.push({
        id: item.id,
        craftType: item.craftType,
        quantity: 1,
        targetPriceMin: price,
        targetPriceMax: price,
        buyerName: item.artisan.name,
      });
      groups.set(key, group);
    }

    return [...groups.values()];
  }, [items]);



  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)] font-sans">
      {/* ------------------------------------------------------------- Nav */}
      <nav className="sticky top-0 z-50 border-b border-gray-200/60 bg-[var(--color-background)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1180px] items-center gap-4 px-4 sm:px-6 lg:px-10">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span
              aria-hidden
              className="kg-display flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-[17px] text-white"
            >
              K
            </span>
            <span className="kg-display text-[21px] leading-none text-gray-900">Karigari</span>
          </Link>

          <div className="ml-auto hidden items-center gap-7 md:flex">
            <Link href="/marketplace" className="text-[14px] font-medium text-gray-600 hover:text-gray-900">
              {t("nav_marketplace")}
            </Link>
            <Link href="/creators" className="text-[14px] font-medium text-gray-600 hover:text-gray-900">
              {t("nav_creator_affiliation")}
            </Link>
            <Link href="/buyer" className="text-[14px] font-medium text-gray-600 hover:text-gray-900">
              {t("nav_buyer")}
            </Link>
            <Link href="/login?role=admin" className="text-[14px] font-medium text-gray-600 hover:text-gray-900">
              {t("nav_for_admins")}
            </Link>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4 md:ml-6">
            <LanguageSwitcher />
            <Link
              href="/login"
              className="hidden text-[14px] font-medium text-gray-600 hover:text-gray-900 sm:block"
            >
              {t("login")}
            </Link>
            <Link
              href="/register"
              className="kg-press inline-flex min-h-[42px] items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* ---------------------------------------------------------- Hero */}
        <section className="relative isolate overflow-hidden">
          <Image
            src="/hero-mural.jpg"
            alt="A hand-painted Pattachitra scroll from Odisha"
            fill
            priority
            sizes="100vw"
            className="-z-10 object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-b from-[#F6F3EE]/85 via-[#F1EAE0]/70 to-[#F6F3EE]/95"
          />

          <div className="mx-auto flex max-w-[820px] flex-col items-center px-4 py-24 text-center sm:px-6 sm:py-32">
            {/* No eyebrow above the headline: the hero leads with the promise
                itself, and the pill was repeating a line the footer and the
                login plate already carry. */}
            <h1 className="kg-display text-[38px] leading-[1.06] text-gray-900 sm:text-[58px] lg:text-[68px]">
              Preserving Heritage,
              <br />
              <em className="not-italic text-[var(--color-maroon)]">Powering the Future</em>
            </h1>

            <p className="mt-6 max-w-[38rem] text-[16px] leading-relaxed text-gray-700 sm:text-[17px]">
              Connecting India&rsquo;s master craftspeople directly to buyers, with verified
              provenance on every piece and{" "}
              {(ARTISAN_TOTAL_RATE * 100).toFixed(2)}% of each sale settled straight to the maker.
            </p>

            <div className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4">
              <Link
                href="/marketplace"
                className="kg-press kg-label inline-flex min-h-[54px] items-center justify-center rounded-xl bg-primary px-8 font-medium text-white hover:bg-primary-dark"
              >
                Explore Marketplace
              </Link>
              <Link
                href="/register"
                className="kg-press kg-label inline-flex min-h-[54px] items-center justify-center rounded-xl border border-gray-900/25 bg-white/80 px-8 font-medium text-gray-900 backdrop-blur-sm hover:border-gray-900/50 hover:bg-white"
              >
                Join as an Artisan
              </Link>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- Stats */}
        <section className="border-y border-gray-200/70 bg-[#F1EDE6]">
          <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-y-10 px-4 py-12 sm:px-6 lg:grid-cols-4 lg:px-10">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="kg-display text-[30px] leading-none text-gray-900 sm:text-[36px]">
                  {loaded ? stat.value : "—"}
                </p>
                <p className="kg-label mt-3 font-medium text-gray-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- Difference */}
        <section className="relative w-full">
          <div className="absolute inset-0 z-0 opacity-[0.08] bg-[url('/droodle-bg.jpg')] bg-repeat bg-[length:500px_auto] mix-blend-multiply pointer-events-none" />
          
          <div className="relative z-10 mx-auto max-w-[1180px] px-4 py-20 sm:px-6 sm:py-24 lg:px-10">
            <div className="mx-auto max-w-2xl text-center">
              <SectionEyebrow>The Karigari Difference</SectionEyebrow>
              <p className="mt-4 text-[17px] leading-relaxed text-gray-600">
                We merge centuries-old technique with modern verification, so fairness and
                authenticity are things you can check rather than things you are asked to believe.
              </p>
            </div>

            <div className="kg-stagger mt-14 grid gap-5 md:grid-cols-3">
              <FeatureCard
                icon={<HandCoins size={20} strokeWidth={1.6} />}
                title="Direct to artisan"
                body={`Zero middlemen. ${(ARTISAN_TOTAL_RATE * 100).toFixed(2)}% of every sale is released to the maker's own UPI in two automatic tranches — on dispatch and on delivery.`}
              />
              <FeatureCard
                icon={<ShieldCheck size={20} strokeWidth={1.6} />}
                title="Verified Origin"
                body="Each piece carries a printed patch ID. The artisan re-photographs the finished work wearing that patch, and the match is what makes it sellable."
              />
              <FeatureCard
                icon={<TrendingUp size={20} strokeWidth={1.6} />}
                title="AI-powered insights"
                body="Fair-wage floors, market price bands and demand forecasting, so an artisan walks into a negotiation already knowing what their work is worth."
              />
            </div>
          </div>
        </section>

        {/* --------------------------------------------- Curated Heritage */}
        <section className="border-t border-gray-200/70 bg-white overflow-hidden">
          <div className="mx-auto max-w-[1180px] px-4 pt-16 sm:px-6 sm:pt-20 lg:px-10 flex flex-col items-center">
            <h2 className="kg-display text-gray-900 leading-tight text-[30px] sm:text-[36px] text-center mb-3">
              Curated Heritage
            </h2>
            <p className="text-center text-[15px] text-gray-500 mb-12 max-w-2xl">
              Every piece on the platform, from verified artisan workshops across India
            </p>
          </div>

          {!loaded ? (
            <div className="flex gap-6 px-6 pb-20 sm:pb-24 overflow-hidden">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="shrink-0 w-[260px]">
                  <div className="kg-shimmer aspect-[4/5] rounded-2xl" />
                  <div className="kg-shimmer mt-3 h-4 w-2/3 rounded" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="mx-auto max-w-[1180px] px-4 pb-20 sm:px-6 sm:pb-24 lg:px-10">
              <p className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-[15px] text-gray-500">
                No pieces are listed on the marketplace yet. The first artisan to publish a
                verified craft will appear here.
              </p>
            </div>
          ) : (
            <HeritageMarquee items={items} />
          )}
        </section>

        {/* ------------------------------------------- Mapping the Roots */}
        <section className="relative border-t border-gray-200/70 bg-[#F1EDE6]">
          <div className="absolute inset-0 z-0 opacity-[0.08] bg-[url('/droodle-bg.jpg')] bg-repeat bg-[length:500px_auto] mix-blend-multiply pointer-events-none" />
          <div className="relative z-10 mx-auto grid max-w-[1180px] items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:px-10">
            <div>
              <SectionEyebrow>Mapping the Roots</SectionEyebrow>
              <h2 className="kg-display mt-4 text-[30px] leading-tight text-gray-900 sm:text-[36px]">
                Every craft has a place it comes from.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-gray-600">
                The registry maps the cluster behind each listing, so you know exactly where — and
                by whom — your piece was made.
              </p>
              <Link
                href="/marketplace"
                className="kg-press mt-8 inline-flex items-center gap-2 text-[14px] font-semibold text-gray-900 hover:underline"
              >
                <MapPin size={15} /> Explore the map
              </Link>
            </div>

            <div className="relative">
              {clusters.length > 0 ? (
                <>
                  <DemandMap home={null} demands={clusters} />
                  <span className="pointer-events-none absolute bottom-4 left-4 z-[400] inline-flex items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 shadow-soft">
                    <span
                      aria-hidden
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-maroon)]"
                    >
                      <MapPin size={13} className="text-white" />
                    </span>
                    <span className="min-w-0">
                      <span className="kg-label block text-gray-400">Active cluster</span>
                      <span className="block truncate text-[13px] font-semibold text-gray-900">
                        {clusters[0].location}
                      </span>
                    </span>
                  </span>
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/60 p-8 text-center text-[14px] text-gray-500">
                  {loaded
                    ? "No cluster has a live listing yet — the map fills in as artisans publish."
                    : "Loading clusters…"}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ Dark CTA */}
        <section className="bg-primary">
          <div className="mx-auto max-w-[820px] px-4 py-20 text-center sm:px-6 sm:py-24">
            <h2 className="kg-display text-[32px] leading-tight text-white sm:text-[42px]">
              Become part of the story
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/70">
              Whether you are a maker looking for a fair market or a collector seeking heritage you
              can verify, there is a place for you in Karigari.
            </p>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
              <Link
                href="/marketplace"
                className="kg-press kg-label inline-flex min-h-[52px] items-center justify-center rounded-xl bg-white px-8 font-medium text-gray-900 hover:bg-gray-100"
              >
                Shop the collection
              </Link>
              <Link
                href="/register"
                className="kg-press kg-label inline-flex min-h-[52px] items-center justify-center rounded-xl border border-white/30 px-8 font-medium text-white hover:border-white/60"
              >
                Register workshop
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------- Footer */}
      <footer className="relative border-t border-gray-200 bg-[var(--color-background)]">
        <div className="absolute inset-0 z-0 opacity-[0.08] bg-[url('/droodle-bg.jpg')] bg-repeat bg-[length:500px_auto] mix-blend-multiply pointer-events-none" />
        <div className="relative z-10 mx-auto grid max-w-[1180px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 lg:px-10">
          <div>
            <p className="kg-display text-[21px] leading-none text-gray-900">Karigari</p>
            <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-gray-500">
              Empowering India&rsquo;s artisanal heritage through technology and transparency.
            </p>
          </div>

          <div>
            <SectionEyebrow>Quick links</SectionEyebrow>
            <ul className="mt-4 space-y-2.5 text-[14px] text-gray-600">
              <li>
                <Link href="/marketplace" className="hover:text-gray-900">
                  Marketplace
                </Link>
              </li>
              <li>
                <Link href="/creators" className="hover:text-gray-900">
                  Creator programme
                </Link>
              </li>
              <li>
                <Link href="/buyer" className="hover:text-gray-900">
                  For buyers
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-gray-900">
                  Artisan sign in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <SectionEyebrow>Honest by default</SectionEyebrow>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-gray-500">
              Provenance is a printed patch ID checked against a re-photograph — not a blockchain.
              Payments run through Razorpay; the artisan payout rails are not wired, so each
              settlement is recorded programmatically rather than as a confirmed bank credit.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="kg-lift rounded-2xl bg-[#F1EDE6] p-7">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-gray-800 shadow-card">
        {icon}
      </span>
      <h3 className="kg-display mt-6 text-[20px] leading-snug text-gray-900">{title}</h3>
      <p className="mt-2.5 text-[14px] leading-relaxed text-gray-600">{body}</p>
    </div>
  );
}
