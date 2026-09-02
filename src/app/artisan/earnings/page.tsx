"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  HandCoins,
  Package,
  Scale,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees, getListingPrice } from "@/lib/pricing";
import { Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatTile } from "@/components/ui/StatTile";
import dynamic from "next/dynamic";
import type { MonthlyEarning } from "@/components/EarningsAnalytics";

/**
 * Recharts is ~90 KB and every chart on this page sits below the fold, so the
 * library is fetched only once the earnings data is on screen. `ssr: false`
 * because the charts measure their own container.
 */
const EarningsAnalytics = dynamic(
  () => import("@/components/EarningsAnalytics").then((m) => m.EarningsAnalytics),
  {
    ssr: false,
    loading: () => <div className="kg-shimmer mt-12 h-[420px] rounded-2xl" />,
  }
);

/**
 * The artisan's money, in one place.
 *
 * Reads `/api/artisan/dashboard` — the same payload the home tab already loads,
 * so this page adds no new endpoint and no new query. Every figure is money
 * that actually moved through the escrow engine: an AI valuation is never shown
 * as an amount received, and the fair-wage index is computed from the artisan's
 * own settled rows rather than being a score handed down from anywhere.
 */

interface Capture {
  id: string;
  craftType: string;
  status: string;
  /** One short string, derived server-side from `images[0]`. Never a blob. */
  thumbnail?: string | null;
  advancePaid?: number | null;
  finalPayoutQueued?: number | null;
  fairWageFloor?: number | null;
  askingPrice?: number | null;
  salePrice?: number | null;
  standardMarketPrice?: number | null;
  createdAt: string;
}

/** Only the fields this page reads. The endpoint returns a great deal more. */
interface DashboardPayload {
  totalEarnings?: number;
  totalGrossSales?: number;
  advancesReceived?: number;
  finalSettlementsCleared?: number;
  itemsSold?: number;
  upiId?: string | null;
  recentCaptures?: Capture[];
  /** Twelve whole months of realised earnings, computed server-side. */
  monthlyEarnings?: MonthlyEarning[];
  artisanProfile?: { annualIncome?: number | null } | null;
  /** The best-selling title, aggregated server-side across every settled row. */
  topProduct?: TopProduct | null;
  bestSellers?: BestSeller[];
}

/** One title's lifetime sales. Revenue is money received, never a valuation. */
interface BestSeller {
  title: string;
  itemId: string;
  unitsSold: number;
  revenue: number;
  grossSales: number;
  lastSoldAt: string;
}

interface TopProduct {
  itemId: string;
  title: string;
  image: string | null;
  unitsSold: number;
  revenue: number;
  grossSales: number;
}

/** How a settlement row reads in the activity list. */
function activityChip(item: Capture): { label: string; variant: BadgeVariant; icon: React.ReactNode } {
  if (item.status === "SOLD_FINAL" || item.status === "PAYOUT_COMPLETED") {
    return { label: "Settled", variant: "success", icon: <CheckCircle2 size={11} /> };
  }
  if (item.status === "ADVANCE_PAID") {
    return { label: "Advance paid", variant: "info", icon: <Banknote size={11} /> };
  }
  if (item.status === "SOLD_MIDDLEMAN") {
    return { label: "Off-platform", variant: "neutral", icon: <Clock size={11} /> };
  }
  return { label: "Processing", variant: "warning", icon: <Clock size={11} /> };
}

export default function EarningsPage() {
  const { t } = useLanguage();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/artisan/dashboard", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json?.success) setData(json.data);
        else setFailed(true);
      } catch (error) {
        console.error("Failed to load earnings:", error);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, []);

  const captures: Capture[] = useMemo(() => data?.recentCaptures ?? [], [data]);

  /** Rows where money actually moved — the only ones that belong in a ledger. */
  const activity = useMemo(
    () =>
      captures
        .filter((item) => (item.advancePaid ?? 0) > 0 || (item.finalPayoutQueued ?? 0) > 0)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [captures]
  );

  /**
   * Fair-wage index: of the pieces that actually sold, how many cleared their
   * own AI fair-wage floor.
   *
   * Computed here from real rows rather than fetched, and honest about its
   * denominator: with nothing sold yet there is no index to report, and the
   * card says so instead of showing a flattering 100%.
   */
  const fairWage = useMemo(() => {
    const sold = captures.filter(
      (item) =>
        (item.status === "SOLD_FINAL" || item.status === "PAYOUT_COMPLETED") &&
        (item.fairWageFloor ?? 0) > 0
    );
    if (sold.length === 0) return null;
    const cleared = sold.filter((item) => {
      const price = item.salePrice ?? getListingPrice(item) ?? 0;
      return price >= (item.fairWageFloor ?? 0);
    }).length;
    return { pct: Math.round((cleared / sold.length) * 100), cleared, total: sold.length };
  }, [captures]);

  const totalBalance = Number(data?.totalEarnings ?? 0);

  return (
    <Shell>
      <div className="mb-9">
        <PageTitle>{t("page_earnings_title")}</PageTitle>
        <PageLede>Every rupee that has reached you, and the escrow tranches still on their way.</PageLede>
      </div>

      {/* Total balance */}
      <Card
        pad="lg"
        className="kg-enter mb-6 relative overflow-hidden text-white border-transparent"
        style={{ background: "linear-gradient(140deg,#1A1A1A 0%, #2E2926 100%)" }}
      >
        <div aria-hidden className="absolute -top-12 -right-10 w-44 h-44 rounded-full bg-white/10 blur-2xl" />
        <div className="relative z-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60 mb-2">
            Total received
          </p>
          {loading ? (
            <div className="h-10 w-40 rounded kg-shimmer opacity-30" />
          ) : (
            <p className="font-sans font-bold text-4xl tracking-tight">
              {formatRupees(totalBalance)}
            </p>
          )}
          <p className="text-xs text-white/60 mt-2 leading-relaxed max-w-sm">
            Advances plus final settlements, released straight to your own VPA by the escrow
            engine. No admin approves or holds any of it.
          </p>

          {data?.upiId ? (
            <p className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-bold break-all">
              <ShieldCheck size={14} className="shrink-0" /> {data.upiId}
            </p>
          ) : (
            <Link
              href="/artisan/dashboard?edit=profile"
              className="kg-press mt-5 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 min-h-[40px] text-[12px] font-bold hover:bg-white/20"
            >
              Add your UPI ID <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </Card>

      {/* Breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8 kg-stagger">
        <StatTile
          label="Gross sales"
          value={formatRupees(data?.totalGrossSales ?? 0)}
          icon={<TrendingUp size={16} />}
          accent="teal"
        />
        <StatTile
          label="40% advances"
          value={formatRupees(data?.advancesReceived ?? 0)}
          icon={<Banknote size={16} />}
          accent="blue"
        />
        <StatTile
          label="Final settlements"
          value={formatRupees(data?.finalSettlementsCleared ?? 0)}
          icon={<HandCoins size={16} />}
          accent="brown"
        />
        <StatTile
          label={t("items_sold")}
          value={data?.itemsSold ?? 0}
          icon={<Package size={16} />}
          accent="orange"
        />
      </div>

      {/* Fair wage index */}
      <SectionLabel>Fair wage index</SectionLabel>
      <Card className="mb-8">
        {fairWage === null ? (
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
              <Scale size={18} />
            </span>
            <p className="text-sm text-gray-500 leading-relaxed">
              Nothing has sold yet, so there is no index to report. It appears here once your
              first piece settles.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3 mb-3">
              <span className="text-sm font-bold text-gray-700">
                {fairWage.cleared} of {fairWage.total} sales cleared their floor
              </span>
              <span className="font-sans font-bold text-2xl text-gray-900">{fairWage.pct}%</span>
            </div>
            <ProgressBar
              value={fairWage.pct}
              label="Fair wage index"
              tone={fairWage.pct >= 80 ? "success" : fairWage.pct >= 50 ? "warning" : "danger"}
            />
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-2">
              <span>Below floor</span>
              <span>Target met</span>
            </div>
          </>
        )}
      </Card>

      {/* Most sold product — sits with the analytics, above the ledger, because
          it answers the same question the charts do: what is actually working.
          Every figure is money received, so the share below reconciles with the
          "Total received" headline rather than quietly counting a valuation. */}
      <SectionLabel>{t("earnings_most_sold")}</SectionLabel>
      <MostSoldCard product={data?.topProduct ?? null} totalEarnings={totalBalance} loading={loading} t={t} />

      {/* The charts read from the same settled rows the ledger below does, so
          the series and the activity list can never disagree. */}
      {!loading && !failed && data && (
        <EarningsAnalytics
          data={{
            monthlyEarnings: data.monthlyEarnings ?? [],
            totalEarnings: Number(data.totalEarnings ?? 0),
            advancesReceived: Number(data.advancesReceived ?? 0),
            finalSettlementsCleared: Number(data.finalSettlementsCleared ?? 0),
            totalGrossSales: Number(data.totalGrossSales ?? 0),
            annualIncome: data.artisanProfile?.annualIncome ?? null,
          }}
        />
      )}

      {/* Recent activity */}
      <SectionLabel
        action={
          <Link href="/artisan/market" className="text-[11px] font-bold text-primary hover:underline">
            {t("view_all")}
          </Link>
        }
      >
        Recent activity
      </SectionLabel>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <div className="h-4 w-1/2 rounded kg-shimmer mb-2" />
              <div className="h-3 w-1/3 rounded kg-shimmer" />
            </Card>
          ))}
        </div>
      ) : failed ? (
        <Card pad="lg" className="border-dashed text-center text-sm text-gray-500 italic">
          Could not load your settlement history.
        </Card>
      ) : activity.length === 0 ? (
        <Card pad="lg" className="border-dashed text-center text-sm text-gray-500 italic">
          No money has moved yet. Advances are released the moment a sold piece is dispatched.
        </Card>
      ) : (
        <ul className="space-y-3 kg-stagger">
          {activity.map((item) => {
            const chip = activityChip(item);
            const amount = (item.advancePaid ?? 0) + (item.finalPayoutQueued ?? 0);
            return (
              <Card as="li" key={item.id} className="kg-list-item flex items-center gap-4">
                <div className="relative h-12 w-12 shrink-0 rounded-xl overflow-hidden bg-gray-100 border border-gray-100">
                  {item.thumbnail ? (
                    <Image
                      src={item.thumbnail}
                      alt=""
                      fill
                      sizes="48px"
                      unoptimized={item.thumbnail.startsWith("data:")}
                      className="object-cover"
                    />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-gray-400">
                      <Package size={18} />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[15px] text-gray-900 truncate">{item.craftType}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {new Date(item.createdAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-sans font-bold text-[15px] text-[var(--color-stat-teal)]">
                    +{formatRupees(amount)}
                  </p>
                  <Badge variant={chip.variant} caps icon={chip.icon} className="mt-1">
                    {chip.label}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-gray-500 italic mt-6 leading-relaxed">
        Prototype: Stripe runs in TEST mode and real UPI payout rails are not wired, so each
        tranche is recorded as a programmatic settlement (test) — direct to your VPA, zero
        middleman. The escrow states and the audit trail are real; the bank credit is simulated.
      </p>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The artisan's best-selling product.
 *
 * Aggregated server-side by title, because the same piece woven three times is
 * three units of one product, not three products. "Revenue contributed" is the
 * money that actually reached the artisan — the 40% advance plus the final
 * settlement — on exactly the same basis as the "Total received" headline, so
 * the share reconciles with it. An AI valuation is never counted as revenue.
 *
 * With nothing settled the card says so plainly instead of rendering a 0% bar,
 * which would read as a real measurement of a real product.
 */
function MostSoldCard({
  product,
  totalEarnings,
  loading,
  t,
}: {
  product: TopProduct | null;
  totalEarnings: number;
  loading: boolean;
  t: (key: string) => string;
}) {
  if (loading) {
    return <div className="kg-shimmer mb-8 h-[132px] rounded-2xl" />;
  }

  if (!product || product.unitsSold === 0) {
    return (
      <Card pad="lg" className="mb-8 border-dashed">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)] text-primary">
            <Package size={18} />
          </span>
          <p className="text-sm leading-relaxed text-gray-500">{t("earnings_no_sales_yet")}</p>
        </div>
      </Card>
    );
  }

  // Guarded division: with no realised earnings there is no share to state, and
  // a 0% bar under a real product would be a claim rather than a blank.
  const share =
    totalEarnings > 0 ? Math.min(100, Math.round((product.revenue / totalEarnings) * 100)) : null;

  return (
    <Card className="kg-enter mb-8">
      <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
        {/* `next/image` throws on an empty src, and an item captured before the
            photo step has exactly that — so the placeholder is a guard, not a
            decoration. */}
        {product.image ? (
          <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-[var(--color-pill)]">
            <Image
              src={product.image}
              alt=""
              fill
              sizes="64px"
              unoptimized={product.image.startsWith("data:")}
              className="object-cover"
            />
          </span>
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)] text-primary">
            <Package size={22} strokeWidth={1.6} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-gray-900">{product.title}</p>
          <p className="kg-label mt-1 text-gray-500">
            {t(product.unitsSold === 1 ? "earnings_unit_sold_one" : "earnings_units_sold").replace(
              "{n}",
              String(product.unitsSold)
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="kg-label text-gray-400">{t("earnings_revenue_contributed")}</p>
          <p className="font-sans text-[17px] font-bold text-[var(--color-stat-teal)]">
            {formatRupees(product.revenue)}
          </p>
        </div>
      </div>

      {share !== null && (
        <div className="mt-4">
          <ProgressBar value={share} label={t("earnings_most_sold")} size="sm" tone="primary" />
          <p className="kg-label mt-2 text-gray-500">
            {t("earnings_share_of_total").replace("{pct}", String(share))}
          </p>
        </div>
      )}
    </Card>
  );
}
