"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BellRing, Loader2, Pin, RefreshCw, TrendingUp } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Shell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { DarkCard } from "@/components/ui/DarkCard";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { ArticleRow, FeaturedArticle, type Article } from "@/components/ui/ArticleCard";
import { AlertRow, NoticeItem } from "@/components/ui/NoticeItem";
import { PageLede, PageTitle, SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import { formatRupees } from "@/lib/pricing";

/**
 * Live news and community.
 *
 * Everything rendered here comes back from a real endpoint: the articles from
 * `/api/artisan/generate-news` (the Groq/RSS pipeline), the notice board from
 * the artisan's own `Notification` rows, and the Market Alerts card from
 * `/api/artisan/insights` — the same engine the Insights tab reads. Nothing is
 * invented to fill the layout: when the summariser is down the page shows the
 * raw headlines it did find and says so.
 */

interface NewsItem {
  type?: string;
  title?: string;
  description?: string;
  date?: string;
  source?: string;
  link?: string;
}

interface Notice {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface MarketSnapshot {
  craftType: string | null;
  priceBand: { floor: number; ceiling: number } | null;
  matchingCount: number;
  totalQuantity: number;
  headline: string | null;
  action: string | null;
}

/**
 * Category for the filter rail.
 *
 * The summariser tags most rows `NEWS`, so the rail would be three empty tabs
 * if it keyed off `type` alone. Rows are classified by what they are about
 * instead, and the rail is then built only from categories that actually
 * matched something.
 */
function categoryOf(item: NewsItem): string {
  const type = String(item.type || "").toUpperCase();
  if (type === "EVENT") return "Events";
  if (type === "GOVT_SCHEME") return "Govt Policy";

  const text = `${item.title || ""} ${item.description || ""}`;
  if (/scheme|ministry|govt|government|policy|subsid|yojana|budget|tariff|gst/i.test(text)) {
    return "Govt Policy";
  }
  if (/award|winner|wins|success|felicitat|honoured|honored|recognis|recogniz/i.test(text)) {
    return "Success Stories";
  }
  return "Market Trends";
}

/** An estimate, and labelled as one by the conventional "min read". */
function readMinutes(item: NewsItem): number {
  const words = `${item.title || ""} ${item.description || ""}`.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 180));
}

function toArticle(item: NewsItem): Article {
  return {
    title: item.title,
    description: item.description,
    date: item.date,
    source: item.source,
    link: item.link,
    category: categoryOf(item),
    readMinutes: readMinutes(item),
    image: null,
  };
}

/** Notification type -> notice-board label and urgency. */
function noticeLabel(type: string): { label: string; tone: "default" | "urgent" } {
  const upper = String(type || "").toUpperCase();
  if (upper === "DEMAND_ALERT") return { label: "Demand", tone: "urgent" };
  if (upper === "FESTIVAL") return { label: "Event", tone: "default" };
  if (upper === "SCHEME") return { label: "Scheme", tone: "default" };
  if (upper === "DISPUTE" || upper === "FLAG") return { label: "Urgent", tone: "urgent" };
  return { label: "Update", tone: "default" };
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function NewsPage() {
  const { t, language } = useLanguage();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Raw RSS headlines the route hands back when the summariser is down. */
  const [headlines, setHeadlines] = useState<{ title: string; link: string }[]>([]);
  const [craftName, setCraftName] = useState("your craft");
  const [clusterName, setClusterName] = useState("your cluster");
  const [category, setCategory] = useState("all");

  const [notices, setNotices] = useState<Notice[]>([]);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two strings, one tiny query — not the whole dashboard payload.
      const dbRes = await fetch('/api/artisan/profile-lite', { cache: 'no-store' });
      const dbData = await dbRes.json();

      const craft = dbData?.craftType || "General Crafts";
      const cluster = dbData?.clusterName || "Local Artisan Cluster";
      setCraftName(craft);
      setClusterName(cluster);

      const res = await fetch('/api/artisan/generate-news', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftType: craft, clusterName: cluster, language })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        setNews(data.data);
        setHeadlines([]);
      } else {
        // No invented article. Show the real headlines if the route sent them.
        setNews([]);
        setHeadlines(Array.isArray(data?.headlines) ? data.headlines : []);
        setError(data?.error || t('news_load_failed'));
      }
    } catch (e) {
      console.error(e);
      setNews([]);
      setError(t('news_load_failed'));
    } finally {
      setLoading(false);
    }
    // `t` is read inside but deliberately not a dependency: the fetch only
    // needs to re-run when the language changes, and listing it here would
    // re-create this callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(fetchData, 0);
    return () => clearTimeout(kickoff);
  }, [fetchData]);

  /**
   * The side rail. Fetched independently of the news pipeline so a slow (or
   * failing) summariser never blanks the notice board, which is the artisan's
   * own data and always available.
   */
  useEffect(() => {
    let cancelled = false;
    const kickoff = setTimeout(async () => {
      try {
        const [noticeRes, insightRes] = await Promise.all([
          fetch("/api/artisan/notifications", { cache: "no-store" }),
          fetch("/api/artisan/insights", { cache: "no-store" }),
        ]);
        const noticeData = await noticeRes.json().catch(() => null);
        const insightData = await insightRes.json().catch(() => null);
        if (cancelled) return;

        if (noticeData?.success) setNotices((noticeData.notifications ?? []).slice(0, 4));
        if (insightData?.success) {
          setMarket({
            craftType: insightData.craftType ?? null,
            priceBand: insightData.priceBand ?? null,
            matchingCount: insightData.demand?.matchingCount ?? 0,
            totalQuantity: insightData.demand?.totalQuantity ?? 0,
            headline: insightData.recommendation?.headline ?? null,
            action: insightData.recommendation?.action ?? null,
          });
        }
      } catch (e) {
        console.warn("Side rail unavailable:", (e as Error)?.message);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, []);

  /** Only categories that actually matched something. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of news) {
      const label = categoryOf(item);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [
      { value: "all", label: "All Updates" },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label]) => ({ value: label, label })),
    ];
  }, [news]);

  const filtered = useMemo(
    () => (category === "all" ? news : news.filter((item) => categoryOf(item) === category)),
    [news, category]
  );

  const [featured, ...rest] = filtered;

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <PageTitle>{t("page_news_title")}</PageTitle>
          <PageLede>
            Live coverage of the {craftName} sector and the schemes, buyers and events around{" "}
            {clusterName}.
          </PageLede>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          aria-label={t("retry")}
          className="kg-press mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-white disabled:opacity-50"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {categories.length > 1 && (
        <div className="mt-9">
          <FilterTabs
            options={categories}
            value={category}
            onChange={setCategory}
            ariaLabel="Update category"
            caps={false}
          />
        </div>
      )}

      <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
        {/* ================================================== Main column */}
        <div className="min-w-0">
          {loading ? (
            <NewsSkeleton />
          ) : error ? (
            <Card pad="lg" className="border-dashed text-center">
              <AlertTriangle size={26} className="mx-auto mb-4 text-gray-400" />
              <p className="kg-display mb-1 text-[19px] text-gray-900">{t("news_load_failed")}</p>
              <p className="mb-7 text-sm text-gray-500">{error}</p>

              {headlines.length > 0 && (
                <div className="mx-auto mb-7 max-w-lg space-y-2 text-left">
                  <SectionEyebrow>{t("news_raw_headlines")}</SectionEyebrow>
                  {headlines.map((headline, i) => (
                    <a
                      key={i}
                      href={headline.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block py-1 text-sm text-gray-800 hover:underline"
                    >
                      {headline.title}
                    </a>
                  ))}
                </div>
              )}

              <button
                onClick={fetchData}
                className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
              >
                <RefreshCw size={15} /> {t("retry")}
              </button>
            </Card>
          ) : filtered.length === 0 ? (
            <Card pad="lg" className="border-dashed text-center text-[14px] text-gray-500">
              Nothing in this category right now.
            </Card>
          ) : (
            <>
              <div className="kg-enter">
                <FeaturedArticle article={toArticle(featured)} />
              </div>

              {rest.length > 0 && (
                <section className="mt-12">
                  {/* No "View archive": the feed below is the whole archive
                      this page has, and the link pointed at the AI Hub, which
                      no longer exists. */}
                  <SectionHeading rule>Recent Articles</SectionHeading>

                  <div className="kg-stagger space-y-4">
                    {rest.map((item, i) => (
                      <ArticleRow key={`${item.link || item.title}-${i}`} article={toArticle(item)} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* =================================================== Side rail */}
        <aside className="min-w-0 space-y-6">
          {/* -------------------------------------------- Notice board */}
          <Card tone="muted" pad="md">
            <h2 className="kg-display mb-4 flex items-center gap-2.5 text-[20px] text-gray-900">
              <Pin size={17} strokeWidth={1.7} className="text-gray-500" />
              Notice Board
            </h2>

            {notices.length === 0 ? (
              <p className="rounded-xl bg-white/70 px-4 py-4 text-[13px] leading-relaxed text-gray-500">
                No notices right now. Demand alerts, festival reminders and scheme updates land
                here as they arrive.
              </p>
            ) : (
              <ul className="space-y-3">
                {notices.map((notice) => {
                  const { label, tone } = noticeLabel(notice.type);
                  return (
                    <NoticeItem
                      key={notice.id}
                      label={label}
                      meta={relativeDay(notice.createdAt)}
                      tone={tone}
                    >
                      {notice.title}
                      <span className="mt-1 block text-[13px] font-normal text-gray-600">
                        {notice.message}
                      </span>
                    </NoticeItem>
                  );
                })}
              </ul>
            )}

            <Link
              href="/artisan/notifications"
              className="kg-label mt-4 inline-flex items-center gap-1.5 font-medium text-gray-600 hover:text-gray-900"
            >
              All notifications <ArrowRight size={12} />
            </Link>
          </Card>

          {/* -------------------------------------------- Market alerts */}
          <DarkCard pad="md" radius="2xl">
            <h2 className="kg-display mb-1 flex items-center gap-2.5 text-[20px] text-white">
              <TrendingUp size={17} strokeWidth={1.7} />
              Market Alerts
            </h2>
            <p className="mb-2 text-[12px] leading-relaxed text-white/50">
              From the same engine as Market Insights — your own valuation band and the live buyer
              demand against it.
            </p>

            {!market ? (
              <div className="space-y-3 py-4">
                <div className="kg-shimmer h-4 w-2/3 rounded opacity-20" />
                <div className="kg-shimmer h-4 w-1/2 rounded opacity-20" />
              </div>
            ) : (
              <ul>
                <AlertRow
                  material={`${market.craftType || craftName} price band`}
                  change={
                    market.priceBand
                      ? `${formatRupees(market.priceBand.floor)} – ${formatRupees(market.priceBand.ceiling)}`
                      : "Not valued yet"
                  }
                  note={
                    market.priceBand
                      ? "AI valuation across your recent captures."
                      : "Capture a piece to get a valuation band."
                  }
                  direction="flat"
                />
                <AlertRow
                  material="Open buyer demand"
                  change={`${market.matchingCount} matching`}
                  note={
                    market.matchingCount > 0
                      ? `${market.totalQuantity} pieces wanted across open buyer requests.`
                      : "No open request matches your craft right now."
                  }
                  direction={market.matchingCount > 0 ? "up" : "flat"}
                />
              </ul>
            )}

            {market?.headline && (
              <p className="mt-4 border-t border-white/10 pt-4 text-[13px] leading-relaxed text-white/70">
                <span className="font-semibold text-white">{market.headline}</span>
                {market.action && <span className="mt-1 block">{market.action}</span>}
              </p>
            )}

            <Link
              href="/artisan/insights"
              className="kg-press kg-label mt-5 flex min-h-[44px] items-center justify-center rounded-xl bg-white font-medium text-gray-900 hover:bg-gray-100"
            >
              Open market insights
            </Link>
          </DarkCard>

          {/* ---------------------------------------------- Daily brief
              The reference has an email newsletter here. Karigari has no mailing
              list and no subscribe endpoint, so rather than a form that goes
              nowhere this card points at the alert rail that does exist: in-app
              notifications and the SMS demand alerts. */}
          <Card pad="md">
            <h2 className="kg-display text-[20px] text-gray-900">Daily Brief</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
              Karigari does not run a mailing list. Demand alerts, festival reminders and scheme
              updates reach you in the app and, where your profile carries a mobile number, by SMS.
            </p>
            <Link
              href="/artisan/notifications"
              className="kg-press kg-label mt-4 flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary font-medium text-white hover:bg-primary-dark"
            >
              <BellRing size={14} /> Configure alerts
            </Link>
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

/** Shimmer that matches the shape of what is coming, not a spinner. */
function NewsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading news">
      <div className="mb-5 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Scanning for local updates…
      </div>
      <div className="kg-shimmer h-[300px] rounded-3xl" />
      <div className="mt-12 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kg-shimmer h-[128px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
