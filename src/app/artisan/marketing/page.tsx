"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Camera,
  Loader2,
  MapPin,
  Megaphone,
  Sparkles,
  GraduationCap,
  CirclePlay,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Badge } from "@/components/ui/Badge";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { nicheForCraft, platformLabel, type PublicCreator } from "@/lib/creators";

/**
 * The artisan's side of the affiliate engine.
 *
 * Opt-in first, then discovery: nobody's craft is pushed into a promotion
 * programme by default. The outreach drafter is a writing aid — it produces a
 * message the artisan copies and sends themselves, and the UI says so. Karigari
 * never sends a DM on anyone's behalf.
 */

interface Attributed {
  id: string;
  craftType: string;
  handle: string | null;
  commission: number | null;
  price: number | null;
  settled: boolean;
}

interface Outreach {
  matchScore: number;
  personalizedDm: string;
  targetHashtags: string[];
}

function PlatformMark({ platform }: { platform: string }) {
  // lucide-react v1 dropped its brand marks, so these are neutral stand-ins
  // rather than Instagram/YouTube logos — the label beside them carries the name.
  if (platform === "INSTAGRAM") return <Camera size={13} />;
  if (platform === "YOUTUBE") return <CirclePlay size={13} />;
  return <GraduationCap size={13} />;
}

export default function ArtisanMarketingPage() {
  const { t, language } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(false);
  const [savingOptIn, setSavingOptIn] = useState(false);
  const [craftType, setCraftType] = useState("");
  const [location, setLocation] = useState("");
  const [attributed, setAttributed] = useState<Attributed[]>([]);

  const [creators, setCreators] = useState<PublicCreator[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/artisan/promotion", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setLoadError(data?.error || t("marketing_load_failed"));
        return;
      }
      setOptIn(Boolean(data.promotionOptIn));
      setCraftType(data.craftType || "");
      setLocation(data.location || data.clusterName || "");
      setAttributed(data.attributedItems || []);
    } catch (error) {
      console.error("Failed to load promotion settings:", error);
      setLoadError(t("marketing_load_failed"));
    } finally {
      setLoading(false);
    }
    // `t` is read inside but deliberately not a dependency: re-creating this
    // callback on every render would re-run the fetch on each language tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(loadSettings, 0);
    return () => clearTimeout(kickoff);
  }, [loadSettings]);

  /**
   * Creators are only fetched once the artisan has opted in.
   *
   * Showing the directory to someone who has not agreed to be promoted would
   * imply they already are.
   */
  useEffect(() => {
    let cancelled = false;

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(() => {
      if (cancelled) return;
      if (!optIn) {
        setCreators([]);
        return;
      }
      setCreatorsLoading(true);

      const params = new URLSearchParams();
      // The craft family and the state, matched loosely server-side — an
      // artisan in "Sambalpur, Odisha" should still see a creator who wrote
      // "Odisha". An unmapped craft drops the niche filter rather than
      // returning an empty list.
      const niche = craftType ? nicheForCraft(craftType) : null;
      if (niche) params.set("niche", niche);
      if (location) params.set("location", location.split(",").pop()?.trim() || location);

      fetch(`/api/creators?${params.toString()}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          setCreators(data?.success ? data.creators || [] : []);
        })
        .catch((error) => {
          console.error("Failed to load creators:", error);
          if (!cancelled) setCreators([]);
        })
        .finally(() => {
          if (!cancelled) setCreatorsLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, [optIn, location, craftType]);

  const toggleOptIn = async () => {
    if (savingOptIn) return;
    const next = !optIn;
    setSavingOptIn(true);
    try {
      const res = await fetch("/api/artisan/promotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promotionOptIn: next }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setOptIn(Boolean(data.promotionOptIn));
      } else {
        setLoadError(data?.error || t("marketing_load_failed"));
      }
    } catch (error) {
      console.error("Failed to save opt-in:", error);
      setLoadError(t("marketing_load_failed"));
    } finally {
      setSavingOptIn(false);
    }
  };

  return (
    <Shell>
      <div className="mb-9">
        <PageTitle>{t("page_marketing_title")}</PageTitle>
        <PageLede>{t("influencer_marketing_subtitle")}</PageLede>
      </div>

        {/* Opt-in */}
        <Card pad="lg" className="kg-enter mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5">
            <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#1A1A1A] flex items-center justify-center shrink-0">
              <Megaphone size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-gray-900 mb-1.5">
                {t("marketing_optin_label")}
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed">{t("marketing_optin_help")}</p>
            </div>

            {/* A real switch, not a checkbox: 44px tall so it is reachable on a
                phone held in one hand. */}
            <button
              type="button"
              role="switch"
              aria-checked={optIn}
              aria-label={t("marketing_optin_label")}
              onClick={toggleOptIn}
              disabled={loading || savingOptIn}
              className={cn(
                "relative shrink-0 w-[64px] h-[36px] rounded-full transition-colors disabled:opacity-50 self-start sm:self-center",
                optIn ? "bg-[#1A1A1A]" : "bg-gray-300"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-[28px] h-[28px] rounded-full bg-white shadow transition-transform flex items-center justify-center",
                  optIn && "translate-x-[28px]"
                )}
              >
                {savingOptIn ? (
                  <Loader2 size={13} className="animate-spin text-gray-500" />
                ) : optIn ? (
                  <Check size={13} className="text-[#1A1A1A]" />
                ) : null}
              </span>
            </button>
          </div>

          {loadError && (
            <p className="mt-4 text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
              {loadError}
            </p>
          )}
        </Card>

        {/* Creators */}
        <section className="mb-10">
          <SectionLabel
            action={
              craftType ? (
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  {craftType}
                  {location ? ` · ${location}` : ""}
                </span>
              ) : undefined
            }
          >
            {t("marketing_nearby_title")}
          </SectionLabel>

          {!optIn ? (
            <Card pad="lg" className="border-dashed text-center text-sm text-gray-500 italic">
              {t("marketing_optin_off_note")}
            </Card>
          ) : loading || creatorsLoading ? (
            <div className="py-14 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1A1A1A]" />
            </div>
          ) : creators.length === 0 ? (
            <Card pad="lg" className="border-dashed text-center">
              <p className="text-sm text-gray-500 italic mb-4">{t("marketing_nearby_empty")}</p>
              <Link
                href="/creators"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1A1A1A] underline underline-offset-4 min-h-[44px]"
              >
                {t("creators_showcase_title")} <ExternalLink size={13} />
              </Link>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {creators.map((creator) => (
                <CreatorRow key={creator.id} creator={creator} language={language} />
              ))}
            </div>
          )}
        </section>

        {/* Affiliate sales on this artisan's own listings */}
        <section>
          <SectionLabel>{t("marketing_attributed_title")}</SectionLabel>
          {attributed.length === 0 ? (
            <Card pad="lg" className="border-dashed text-center text-sm text-gray-500 italic">
              {t("marketing_attributed_empty")}
            </Card>
          ) : (
            <ul className="space-y-3">
              {attributed.map((item) => (
                <li
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-card"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{item.craftType}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      @{item.handle || "—"} · {formatRupees(item.price)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {t("creator_earned")}
                    </p>
                    <p className="text-sm font-bold text-[#1A1A1A]">
                      {formatRupees(item.commission)}
                    </p>
                    <p className="text-[10px] font-bold text-gray-400 mt-0.5">
                      {item.settled ? t("creator_sales") : t("creators_pending")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/*  One creator, with the AI outreach drafter                                 */
/* -------------------------------------------------------------------------- */

function CreatorRow({ creator, language }: { creator: PublicCreator; language: string }) {
  const { t } = useLanguage();
  const [drafting, setDrafting] = useState(false);
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = async () => {
    if (drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/creators/match-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: creator.handle, language }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("marketing_outreach_failed"));
        return;
      }
      setOutreach(data.data as Outreach);
    } catch (draftError) {
      console.error("Outreach draft failed:", draftError);
      setError(t("marketing_outreach_failed"));
    } finally {
      setDrafting(false);
    }
  };

  const copyDm = async () => {
    if (!outreach) return;
    const text = [outreach.personalizedDm, outreach.targetHashtags.join(" ")]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="bg-white border border-gray-200 rounded-2xl shadow-card p-5 flex flex-col">
      <div className="flex items-start gap-3">
        <Avatar name={creator.name} src={creator.photoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 truncate">{creator.name}</h3>
          <p className="text-xs text-gray-500 truncate">@{creator.handle}</p>
        </div>
        {outreach && (
          <span className="shrink-0 bg-[var(--color-mint)] text-primary text-[10px] font-bold px-2 py-1 rounded-md">
            {t("marketing_match_score")} {outreach.matchScore}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-1 rounded-md">
          <PlatformMark platform={creator.platform} />
          {platformLabel(creator.platform)}
        </span>
        <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-1 rounded-md">
          {creator.nicheCategory}
        </span>
        {creator.location && (
          <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-1 rounded-md">
            <MapPin size={10} /> {creator.location}
          </span>
        )}
      </div>

      <p className="text-[11px] text-gray-500 mt-3">
        {creator.totalClicks} {t("creator_clicks")} · {creator.totalSales} {t("creator_sales")}
      </p>

      {outreach ? (
        <div className="mt-4 rounded-xl border border-[var(--color-sage)]/60 bg-[var(--color-mint)]/40 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary/70 flex items-center gap-1.5 mb-2">
            <Sparkles size={11} /> {t("marketing_ai_label")}
          </p>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
            {outreach.personalizedDm}
          </p>
          {outreach.targetHashtags.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-3 mb-1.5">
                {t("marketing_hashtags")}
              </p>
              <p className="text-xs text-primary break-words">{outreach.targetHashtags.join(" ")}</p>
            </>
          )}
          <button
            type="button"
            onClick={copyDm}
            className="mt-4 w-full min-h-[44px] rounded-xl bg-primary hover:bg-primary-dark text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("creators_copied") : t("creators_copy")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={draft}
          disabled={drafting}
          className="mt-auto pt-4 w-full min-h-[44px] text-xs font-bold text-[#1A1A1A] flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {t("marketing_draft_outreach")}
        </button>
      )}

      {error && (
        <p className="mt-3 text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-2.5">
          {error}
        </p>
      )}
    </article>
  );
}
