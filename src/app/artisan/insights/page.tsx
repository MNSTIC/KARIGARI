"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { TrendingUp, MapPin, Package, Sparkles, Info, X, Building2, Download } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { NotificationsBell, type ArtisanNotification } from "@/components/NotificationsBell";
import { Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Badge } from "@/components/ui/Badge";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { GovExportModal } from "@/components/GovExportModal";
import { WhatsAppSimulation, type SimulationDemand } from "@/components/WhatsAppSimulation";
import type { DemandMarker, HomeMarker } from "@/components/DemandMap";
import { distanceKm, locateCity } from "@/lib/indiaGeo";

/**
 * Three.js 3D India model — only loaded in the browser since it uses WebGL.
 * Everything else on this page renders on the server as usual.
 */
const IndiaMap3D = dynamic(() => import("@/components/IndiaMap3D"), {
  ssr: false,
  loading: () => (
    <div className="w-full aspect-video rounded-xl border border-gray-200 bg-[var(--color-mint)]/30 animate-pulse" />
  ),
});

/** A demand is "just posted" for this long — drives the pin pulse and the badge. */
const FRESH_WINDOW_MS = 15 * 60 * 1000;

interface BoardDemand {
  id: string;
  craftType: string;
  quantity: number;
  targetPriceMin: number | null;
  targetPriceMax: number | null;
  location: string | null;
  festival: string | null;
  buyerName: string | null;
  createdAt: string;
}

interface Recommendation {
  trigger: string;
  headline: string;
  action: string;
  priceMin: number | null;
  priceMax: number | null;
  source: "gemini" | "rules";
}

interface InsightsResponse {
  success: boolean;
  craftType: string | null;
  cluster: string | null;
  profileLocation: string | null;
  hasMobileNumber: boolean;
  demand: {
    matchingCount: number;
    totalQuantity: number;
    openCount: number;
    topDemands: BoardDemand[];
    matchingIds: string[];
  };
  ownSupply: number;
  priceBand: { floor: number; ceiling: number } | null;
  recommendation: Recommendation;
}

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

export default function InsightsPage() {
  const { t } = useLanguage();

  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [board, setBoard] = useState<BoardDemand[]>([]);
  /**
   * Two independent loads. The insights call waits on a language model and can
   * take many seconds; the demand board is a plain query. Gating the map on the
   * slower of the two would leave it blank long after its data had arrived.
   */
  const [boardLoading, setBoardLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [latestAlert, setLatestAlert] = useState<ArtisanNotification | null>(null);
  /**
   * Stamped when the board arrives rather than read during render: "just
   * posted" must be decided once, not re-evaluated on every re-render.
   */
  const [loadedAt, setLoadedAt] = useState(0);
  /** The offline-fallback demo plays in a modal, opened from the banner below. */
  const [isWhatsappSimOpen, setIsWhatsappSimOpen] = useState(false);
  /** Which end of the AI price band the benchmarking card is reading. */
  const [priceGrade, setPriceGrade] = useState<"master" | "standard">("master");
  /** Government-catalog export (GeM CSV/JSON + this artisan's Beckn payload). */
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [artisanId, setArtisanId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/demand?limit=100", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data?.success) {
          setBoard(data.demands || []);
          setLoadedAt(Date.now());
        }
      } catch (error) {
        console.error("Failed to load the demand board:", error);
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    })();

    (async () => {
      try {
        const res = await fetch("/api/artisan/insights", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data?.success) setInsights(data);
        else setFailed(true);
      } catch (error) {
        console.error("Failed to load market insights:", error);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data?.userId) setArtisanId(data.userId);
      } catch {
        // Non-fatal: the export falls back to the unscoped public catalog.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The bell owns the fetch; the simulation replays whatever it found. */
  const handleNotifications = useCallback((list: ArtisanNotification[]) => {
    setLatestAlert(list.find((n) => n.type === "DEMAND_ALERT") ?? null);
  }, []);

  const craft = insights?.craftType || t("your_craft");
  /** Server-side match verdict, reused rather than re-implemented here. */
  const matchingIds = useMemo(
    () => new Set(insights?.demand.matchingIds ?? []),
    [insights]
  );

  const home: HomeMarker | null = useMemo(() => {
    const label = insights?.cluster || insights?.profileLocation;
    const point = locateCity(label);
    if (!label || !point) return null;
    return { lat: point.lat, lon: point.lon, label, supply: insights?.ownSupply };
  }, [insights]);

  /**
   * One marker per resolvable location. Demands whose location we cannot place
   * are listed under the map instead of being pinned at an invented coordinate.
   */
  const { markers, unmapped, freshCount } = useMemo(() => {
    const groups = new Map<string, DemandMarker>();
    const unplaceable: BoardDemand[] = [];
    const now = loadedAt;
    let fresh = 0;

    for (const demand of board) {
      const isFresh = now > 0 && now - new Date(demand.createdAt).getTime() < FRESH_WINDOW_MS;
      if (isFresh) fresh += 1;

      const point = locateCity(demand.location);
      if (!point) {
        unplaceable.push(demand);
        continue;
      }

      const key = (demand.location || "").toLowerCase().trim();
      const entry = {
        id: demand.id,
        craftType: demand.craftType,
        quantity: demand.quantity,
        targetPriceMin: demand.targetPriceMin,
        targetPriceMax: demand.targetPriceMax,
        festival: demand.festival,
        buyerName: demand.buyerName,
      };

      const existing = groups.get(key);
      if (existing) {
        existing.demands.push(entry);
        existing.totalQuantity += demand.quantity;
        existing.mine = existing.mine || matchingIds.has(demand.id);
        existing.fresh = existing.fresh || isFresh;
        continue;
      }

      groups.set(key, {
        id: key,
        lat: point.lat,
        lon: point.lon,
        location: demand.location || key,
        distanceKm: home ? distanceKm({ lat: home.lat, lon: home.lon }, point) : null,
        mine: matchingIds.has(demand.id),
        fresh: isFresh,
        totalQuantity: demand.quantity,
        demands: [entry],
      });
    }

    return {
      markers: Array.from(groups.values()),
      unmapped: unplaceable,
      freshCount: fresh,
    };
  }, [board, home, matchingIds, loadedAt]);

  /** The demand the simulation quotes: the best match, else the newest on the board. */
  const simulationDemand: SimulationDemand | null = useMemo(() => {
    const top = insights?.demand.topDemands?.[0] ?? board[0] ?? null;
    if (!top) return null;
    return {
      id: top.id,
      craftType: top.craftType,
      quantity: top.quantity,
      targetPriceMin: top.targetPriceMin,
      targetPriceMax: top.targetPriceMax,
      location: top.location,
      festival: top.festival,
      buyerName: top.buyerName,
    };
  }, [insights, board]);

  const recommendation = insights?.recommendation ?? null;
  const alertsActive = Boolean(insights?.hasMobileNumber);

  /**
   * The bell still renders on this page only so the notification list it loads
   * can be lifted into the SMS simulation below. The visible trigger lives in
   * the shell header, so this copy is hidden from sight but not from the
   * accessibility tree's point of view — it is genuinely not interactive here.
   */
  const bellSink = (
    <div className="sr-only" aria-hidden>
      <NotificationsBell onNotifications={handleNotifications} />
    </div>
  );

  return (
    <Shell className="space-y-6">
      <div className="mb-9">
        <PageTitle>{t("nav_market_insights")}</PageTitle>
        <PageLede>{t("market_insights_subtitle")}</PageLede>
      </div>

        {bellSink}

        {/* ---------------- Global market pulse ---------------- */}
        <Card
          pad="lg"
          tone="muted"
          className="kg-enter"
        >
          {/* The page lede already carries the subtitle; repeating it here read
              as a duplicated sentence once the page grew its own title. */}
          <SectionLabel>Global market pulse</SectionLabel>

          <div className="grid grid-cols-3 gap-3">
            <PulseFigure label={t("open_demands_count")} value={board.length} />
            <PulseFigure
              label={t("demands_for_your_craft")}
              value={insights?.demand.matchingCount ?? 0}
            />
            <PulseFigure label={t("units_wanted")} value={insights?.demand.totalQuantity ?? 0} />
          </div>

          <p className="text-xs text-gray-500 mt-4">
            Top category for you: <strong className="text-primary">{craft}</strong>
          </p>
        </Card>

        {/* ---------------- Live demand map ---------------- */}
        <Card>
          <div className="flex justify-between items-start gap-3 mb-4">
            <div className="min-w-0">
              <h2 className="font-serif font-bold text-xl text-gray-900 mb-1">{t("live_demand_map")}</h2>
              <p className="text-gray-500 text-sm">
                {t("demand_map_subtitle")} <strong className="text-primary">{craft}</strong>.
              </p>
            </div>
            {freshCount > 0 && (
              <Badge variant="mint" caps className="shrink-0 kg-fade">
                {t("new_buyer_demand")}
              </Badge>
            )}
          </div>

          {boardLoading ? (
            <div className="w-full aspect-video rounded-xl border border-gray-200 bg-[var(--color-mint)]/30 animate-pulse" />
          ) : (
            <IndiaMap3D home={home} demands={markers} />
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-5 px-1">
            <span className="flex items-center gap-2 text-xs font-bold text-gray-600">
              <span className="w-3 h-3 rounded-full bg-[var(--color-stat-teal)]" /> {t("legend_your_craft")}
            </span>
            <span className="flex items-center gap-2 text-xs font-bold text-gray-600">
              <span className="w-3 h-3 rounded-full bg-primary-light" /> {t("legend_other_craft")}
            </span>
            <span className="flex items-center gap-2 text-xs font-bold text-gray-600">
              <span className="w-3 h-3 rounded-full bg-[var(--color-stat-orange)]" /> {t("legend_just_posted")}
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
            <span className="font-bold text-primary">
              {board.length} {t("open_demands_count")}
            </span>
            {insights && (
              <span>
                {t("demands_for_your_craft")}: <strong>{insights.demand.matchingCount}</strong>
              </span>
            )}
            {insights && insights.demand.totalQuantity > 0 && (
              <span>
                {t("units_wanted")}: <strong>{insights.demand.totalQuantity}</strong>
              </span>
            )}
          </div>

          {!boardLoading && board.length === 0 && (
            <p className="mt-4 text-sm text-gray-500 italic">{t("no_open_demands")}</p>
          )}

          {unmapped.length > 0 && (
            <div className="mt-4 bg-[var(--color-mint)]/40 border border-[var(--color-sage)]/40 rounded-xl p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary mb-2 flex items-center gap-1.5">
                <MapPin size={12} /> {t("not_on_map")}
              </p>
              <ul className="space-y-1">
                {unmapped.map((demand) => (
                  <li key={demand.id} className="text-xs text-gray-600">
                    {demand.quantity} × {demand.craftType}
                    {demand.location ? ` — ${demand.location}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* ---------------- Price benchmarking ----------------
            The band is the one the insights engine actually returned for this
            craft. The toggle switches the end of the band being read, not the
            numbers: there is no second, invented dataset behind it. */}
        {recommendation && recommendation.priceMin !== null && recommendation.priceMax !== null && (
          <Card>
            <SectionLabel>Price benchmarking</SectionLabel>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              {t("suggested_price_band")} for <strong className="text-primary">{craft}</strong>.
            </p>

            <SegmentedToggle
              ariaLabel="Price grade"
              value={priceGrade}
              onChange={setPriceGrade}
              className="mb-5"
              options={[
                { value: "master" as const, label: "Master" },
                { value: "standard" as const, label: "Standard" },
              ]}
            />

            <dl className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  {priceGrade === "master" ? "Top of band" : "Base of band"}
                </dt>
                <dd className="font-sans font-bold text-xl text-gray-900">
                  {rupees(priceGrade === "master" ? recommendation.priceMax : recommendation.priceMin)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-gray-100">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  Full band
                </dt>
                <dd className="font-sans font-bold text-sm text-gray-700">
                  {rupees(recommendation.priceMin)} - {rupees(recommendation.priceMax)}
                </dd>
              </div>
            </dl>

            <p className="text-[11px] text-gray-500 italic mt-4 leading-relaxed">
              One band from the insights engine, read from either end. Karigari holds no separate
              master-grade price list, so nothing here is a second opinion dressed up as one.
            </p>
          </Card>
        )}

        {/* ---------------- AI recommendation ---------------- */}
        <Card pad="lg" tone="primary" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />

          <h3 className="text-lg font-serif font-bold mb-3 flex items-center gap-2">
            <TrendingUp size={20} /> {t("ai_recommendation")}
          </h3>

          {insightsLoading ? (
            <p className="text-sm text-white/70 animate-pulse py-4">{t("reading_market_signals")}</p>
          ) : !recommendation ? (
            <p className="text-sm text-white/80 py-2">{t("insights_unavailable")}</p>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 bg-white/15 text-white text-[11px] font-bold px-3 py-1 rounded-full mb-3">
                <Sparkles size={11} /> {recommendation.trigger}
              </span>

              <p className="text-sm text-white/85 mb-5 leading-relaxed">{recommendation.headline}</p>

              <div className="bg-white/10 p-4 rounded-xl border border-white/20 mb-4">
                <div className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">
                  {t("suggested_action")}
                </div>
                <div className="text-sm font-bold">{recommendation.action}</div>
              </div>

              {recommendation.priceMin !== null && recommendation.priceMax !== null && (
                <div className="bg-white/10 p-4 rounded-xl border border-white/20 mb-4">
                  <div className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">
                    {t("suggested_price_band")}
                  </div>
                  <div className="text-sm font-bold">
                    {rupees(recommendation.priceMin)} – {rupees(recommendation.priceMax)}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-white/50 mb-5 flex items-center gap-1.5">
                <Info size={11} className="shrink-0" />
                {recommendation.source === "gemini" ? t("source_ai") : t("source_rules")}
              </p>

            </>
          )}
        </Card>

        {/* ---------------- List on ONDC ----------------
            Its own section rather than a button buried in the AI card: this is
            an action the artisan takes on their whole catalogue, not a
            follow-up to one recommendation. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="flex flex-col">
            <span className="w-10 h-10 rounded-xl bg-green-50 text-primary flex items-center justify-center mb-3">
              <Package size={18} />
            </span>
            <h3 className="font-bold text-[15px] text-gray-900 mb-1">{t("list_on_ondc")}</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">{t("list_on_ondc_subtitle")}</p>
            <Link
              href="/artisan/market?tab=syndication"
              className="kg-press mt-auto bg-primary hover:bg-primary-dark text-white min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2"
            >
              {t("list_on_ondc")}
            </Link>
          </Card>

          {/* ---------------- Government catalog export ---------------- */}
          <Card className="flex flex-col">
            <span className="w-10 h-10 rounded-xl bg-green-50 text-primary flex items-center justify-center mb-3">
              <Building2 size={18} />
            </span>
            <h3 className="font-bold text-[15px] text-gray-900 mb-1">{t("gov_export_title")}</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">{t("gov_export_subtitle")}</p>
            <button
              onClick={() => setIsExportOpen(true)}
              className="kg-press mt-auto bg-primary hover:bg-primary-dark text-white min-h-[44px] rounded-xl font-bold text-sm flex items-center justify-center gap-2"
            >
              <Download size={16} /> {t("gov_export_cta")}
            </button>
          </Card>
        </div>

        {/* ---------------- SMS auto-pilot ---------------- */}
        <Card pad="lg">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-bold text-primary uppercase tracking-wider">{t("sms_auto_pilot")}</h3>
            {latestAlert && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-[var(--color-mint)] text-primary px-2 py-1 rounded-full">
                {t("latest_alert_ready")}
              </span>
            )}
          </div>

          <div className="bg-[var(--color-mint)]/50 text-primary p-4 rounded-xl text-sm mb-5 border border-[var(--color-sage)]/40">
            <strong className="flex items-center gap-2 mb-1">
              <Info size={16} /> {t("no_internet_no_problem")}
            </strong>
            <p className="text-primary/75 text-xs leading-relaxed">
              {alertsActive ? t("auto_pilot_body_active") : t("auto_pilot_body_inactive")}
            </p>
          </div>

          {/* Offline-fallback demo. The slab wears the brand green rather than
              the emerald/teal it arrived in, so it sits inside the page instead
              of shouting over it. */}
          <div className="bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)] rounded-2xl p-6 shadow-card text-white flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg mb-1">{t("offline_demo_title")}</h3>
              <p className="text-white/80 text-sm">{t("offline_demo_body")}</p>
            </div>
            <button
              onClick={() => setIsWhatsappSimOpen(true)}
              className="bg-white text-primary font-bold px-6 py-3 rounded-xl shadow hover:bg-[var(--color-mint)] transition-colors whitespace-nowrap"
            >
              {t("run_simulation")}
            </button>
          </div>
        </Card>

        {failed && !insightsLoading && (
          <p className="text-sm text-gray-500 text-center">{t("insights_unavailable")}</p>
        )}

      <GovExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        artisanId={artisanId}
      />

      {isWhatsappSimOpen && (
        <div
          id="whatsapp-simulator-modal"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setIsWhatsappSimOpen(false)}
        >
          <div
            className="bg-card rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-primary uppercase tracking-wider">
                {t("offline_demo_title")}
              </h3>
              <button
                onClick={() => setIsWhatsappSimOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={t("close_btn")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              <WhatsAppSimulation
                craftType={insights?.craftType}
                demand={simulationDemand}
                alertMessage={latestAlert?.message ?? null}
                channel={latestAlert?.channel ?? null}
                alertsActive={alertsActive}
              />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** One figure in the market-pulse row. Real counts only, zero included. */
function PulseFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-card border border-gray-100 px-3 py-3 min-w-0">
      <p className="font-sans font-bold text-xl text-gray-900">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-0.5 leading-tight">
        {label}
      </p>
    </div>
  );
}
