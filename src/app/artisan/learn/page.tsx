"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Camera,
  IndianRupee,
  Palette,
  Play,
  QrCode,
  Sparkles,
  TrendingUp,
  UserCog,
} from "lucide-react";
import { AssistantChat } from "@/components/ui/AssistantChat";
import { Card } from "@/components/ui/Card";
import { Shell } from "@/components/ui/AppShell";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import { SkillStageCard } from "@/components/learn/SkillStageCard";
import { LearningTracks } from "@/components/learn/LearningTracks";
import { fill } from "@/components/buyer/passportFormat";
import { useArtisanIdentity } from "@/lib/artisanIdentity";
import { useLearningPlan } from "@/lib/useLearningPlan";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * AI Learning.
 *
 * Two deliberate departures from the reference:
 *
 *  - **Masterclasses do not pre-fetch videos.** The chat route finds one
 *    tutorial per question against a rate-limited key, and firing six of those
 *    on page load would burn the day's quota before the artisan asked anything.
 *    Each card opens the assistant with the question already typed, and the
 *    real video arrives from the real pipeline when they send it. There is no
 *    invented duration or author on these cards, because there is no video yet
 *    to have one.
 *  - **Active Assignments are the artisan's own outstanding work**, read from
 *    `/api/artisan/dashboard` and `/api/artisan/profile-lite` — drafts to
 *    finish, patches to attach, profile fields that are gating scheme
 *    eligibility. The app has no coursework model, and a list of fabricated
 *    homework would be worse than useless to someone deciding what to do next.
 *    Only the profile assignment has a bar: four fields, some filled, is a real
 *    fraction. The others are counts, and a bar on a count would be invented.
 *
 * V12 adds, between the two:
 *
 *  - **The skill stage** (src/lib/skillStage.ts), derived from the artisan's
 *    record on every load and never stored, with the real have/need behind it.
 *  - **Three learning tracks** — business, design, digital — each card a
 *    YouTube *search*, from the AI when it answers and from the curated
 *    catalogue when it does not (src/lib/learningCatalog.ts). The last answer is
 *    saved on the phone (src/lib/learningCache.ts), so the page opens offline.
 */

/** Technique prompts, phrased for the artisan's own craft at render time. */
const MASTERCLASSES: { id: string; labelKey: string; tone: "rust" | "maroon"; icon: React.ReactNode }[] = [
  { id: "finish", labelKey: "learn_mc_label_technique", tone: "maroon", icon: <Palette size={18} strokeWidth={1.6} /> },
  { id: "pattern", labelKey: "learn_mc_label_design", tone: "maroon", icon: <Sparkles size={18} strokeWidth={1.6} /> },
  { id: "material", labelKey: "learn_mc_label_materials", tone: "maroon", icon: <Boxes size={18} strokeWidth={1.6} /> },
  { id: "pricing", labelKey: "learn_mc_label_business", tone: "rust", icon: <IndianRupee size={18} strokeWidth={1.6} /> },
  { id: "selling", labelKey: "learn_mc_label_digital", tone: "maroon", icon: <TrendingUp size={18} strokeWidth={1.6} /> },
];

/** The profile fields the scheme engine checks, as i18n keys. */
const PROFILE_FIELD_KEYS = {
  socialCategory: "learn_field_social_category",
  annualIncome: "learn_field_annual_income",
  aadhaar: "learn_field_aadhaar",
  upi: "learn_field_upi",
} as const;
const PROFILE_FIELDS_CHECKED = Object.keys(PROFILE_FIELD_KEYS).length;

interface Assignment {
  id: string;
  title: string;
  meta: string;
  /** 0–100, only where a real fraction exists. */
  progress: number | null;
  cta: string;
  href: string;
  icon: React.ReactNode;
}

export default function LearnPage() {
  const { t, language } = useLanguage();
  const identity = useArtisanIdentity();
  const craft = identity.craftType || t("your_craft");

  const [seed, setSeed] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const plan = useLearningPlan(language, identity.craftType);

  useEffect(() => {
    let cancelled = false;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/artisan/dashboard", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data?.success) setDashboard(data.data);
      } catch (error) {
        // Offline is an expected state on this page; the assignments card says
        // so by staying empty rather than by logging an error.
        console.warn("Could not load your outstanding work:", (error as Error)?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, []);

  const masterclasses = useMemo(
    () =>
      MASTERCLASSES.map((entry) => ({
        ...entry,
        title: t(`learn_mc_${entry.id}_title`),
        ask: fill(t(`learn_mc_${entry.id}_ask`), { craft }),
      })),
    [craft, t]
  );

  /** Real outstanding work, in the order it is worth doing. */
  const assignments = useMemo<Assignment[]>(() => {
    if (!dashboard) return [];
    const captures: any[] = dashboard.recentCaptures ?? [];
    const list: Assignment[] = [];

    const drafts = captures.filter((c) => c.status === "IVR_DRAFT");
    if (drafts.length > 0) {
      list.push({
        id: "drafts",
        title: t("learn_assign_drafts_title"),
        meta: fill(t("learn_assign_drafts_meta"), { n: drafts.length }),
        progress: null,
        cta: t("learn_assign_drafts_cta"),
        href: "/artisan/dashboard",
        icon: <Camera size={18} strokeWidth={1.6} />,
      });
    }

    const awaitingPatch = captures.filter(
      (c) => c.status === "VERIFIED" && !c.qrVerified && c.patchId
    );
    if (awaitingPatch.length > 0) {
      list.push({
        id: "patch",
        title: t("learn_assign_patch_title"),
        meta: fill(t("learn_assign_patch_meta"), { n: awaitingPatch.length }),
        progress: null,
        cta: t("learn_assign_patch_cta"),
        href: "/artisan/dashboard",
        icon: <QrCode size={18} strokeWidth={1.6} />,
      });
    }

    const profile = dashboard.artisanProfile ?? {};
    const missing = [
      !profile.socialCategory && PROFILE_FIELD_KEYS.socialCategory,
      profile.annualIncome === null || profile.annualIncome === undefined ? PROFILE_FIELD_KEYS.annualIncome : null,
      !profile.aadhaarLast4 && PROFILE_FIELD_KEYS.aadhaar,
      !profile.upiId && PROFILE_FIELD_KEYS.upi,
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
      list.push({
        id: "profile",
        title: t("learn_assign_profile_title"),
        meta: fill(t("learn_assign_profile_meta"), { fields: missing.map((key) => t(key)).join(", ") }),
        progress: Math.round(((PROFILE_FIELDS_CHECKED - missing.length) / PROFILE_FIELDS_CHECKED) * 100),
        cta: t("learn_assign_profile_cta"),
        href: "/artisan/dashboard?edit=profile",
        icon: <UserCog size={18} strokeWidth={1.6} />,
      });
    }

    const unlisted = captures.filter(
      (c) => c.status === "SELLABLE" && !c.isListedOnMarketplace
    );
    if (unlisted.length > 0) {
      list.push({
        id: "listing",
        title: t("learn_assign_listing_title"),
        meta: fill(t("learn_assign_listing_meta"), { n: unlisted.length }),
        progress: null,
        cta: t("learn_assign_listing_cta"),
        href: "/artisan/dashboard",
        icon: <TrendingUp size={18} strokeWidth={1.6} />,
      });
    }

    return list;
  }, [dashboard, t]);

  return (
    <Shell>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-10">
        {/* ============================================== Main column */}
        <div className="min-w-0">
          {/* --------------------------------------------------- Hero */}
          <section className="kg-enter relative isolate overflow-hidden rounded-3xl">
            <Image
              src="/hero-mural.jpg"
              alt=""
              aria-hidden
              fill
              sizes="(max-width: 1280px) 100vw, 760px"
              className="-z-10 object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-gradient-to-r from-black/80 via-black/55 to-black/25"
            />

            <div className="max-w-lg p-8 sm:p-10">
              <h1 className="kg-display text-[36px] leading-[1.05] text-white sm:text-[46px]">
                {t("learn_hero_title")}
              </h1>
              <p className="mt-4 text-[15px] leading-relaxed text-white/75">
                {fill(t("learn_hero_body"), { craft })}
              </p>
              <button
                onClick={() => setSeed("")}
                className="kg-press kg-label mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-6 font-medium text-gray-900 hover:bg-gray-100"
              >
                {t("learn_start")} <ArrowRight size={14} />
              </button>
            </div>
          </section>

          {/* ---------------------------------------------- Skill stage */}
          <div className="mt-5">
            <SkillStageCard
              stage={plan.stage}
              inputs={plan.inputs}
              earnings={plan.earnings}
              loading={plan.origin === null}
            />
          </div>

          {/* ------------------------------------------ Masterclasses */}
          <section className="mt-14">
            {/* No "View all": every masterclass this page has is already on it,
                and the link used to point at the AI Hub, which no longer
                exists. A CTA to a destination that does not exist is worse
                than no CTA. */}
            <SectionHeading>{t("learn_masterclasses")}</SectionHeading>

            <div className="kg-stagger grid gap-5 sm:grid-cols-2">
              {masterclasses.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setSeed(entry.ask)}
                  className="kg-lift overflow-hidden rounded-2xl border border-gray-200/70 bg-card text-left shadow-card"
                >
                  {/* No thumbnail and no duration: there is no video yet. A
                      play glyph over an empty frame with an invented runtime
                      would be a picture of content that does not exist. */}
                  <div className="relative flex h-32 items-center justify-center bg-[var(--color-gray-100)]">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-gray-900 shadow-card">
                      <Play size={18} className="ml-0.5" />
                    </span>
                    <span className="kg-label absolute bottom-3 right-3 rounded-md bg-white/85 px-2 py-1 font-medium text-gray-600">
                      {t("learn_live_lesson")}
                    </span>
                  </div>

                  <div className="p-5">
                    <SectionEyebrow tone={entry.tone}>{t(entry.labelKey)}</SectionEyebrow>
                    <h3 className="kg-display mt-2 text-[19px] leading-snug text-gray-900">
                      {entry.title}
                    </h3>
                    <p className="mt-2 flex items-center gap-2 text-[13px] text-gray-500">
                      <span className="text-gray-400">{entry.icon}</span>
                      {fill(t("learn_asks_assistant"), { craft })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ---------------------------------------- Learning tracks */}
          <LearningTracks
            tracks={plan.tracks}
            completed={plan.completed}
            pendingKey={plan.pendingKey}
            source={plan.source}
            mixed={plan.mixed}
            origin={plan.origin}
            generatedAt={plan.generatedAt}
            showingSaved={plan.showingSaved}
            // The route reports an unset craft as null; the header identity
            // only stands in when there is no answer to read it from.
            craftType={plan.origin === "fallback" ? identity.craftType : plan.craftType ?? ""}
            saveError={plan.saveError}
            onStart={plan.markStarted}
            onToggle={plan.toggleDone}
            onDismissError={plan.dismissError}
          />

          {/* --------------------------------------- Active assignments */}
          <section className="mt-14">
            <SectionHeading>{t("learn_assignments")}</SectionHeading>

            {loading ? (
              <div className="space-y-4">
                {[0, 1].map((i) => (
                  <div key={i} className="kg-shimmer h-[92px] rounded-2xl" />
                ))}
              </div>
            ) : assignments.length === 0 ? (
              <Card tone="muted" pad="lg" className="text-[14px] leading-relaxed text-gray-600">
                {t("learn_assignments_empty")}
              </Card>
            ) : (
              <ul className="kg-stagger space-y-4">
                {assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200/70 bg-card p-4 shadow-card sm:p-5"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-pill)] text-gray-700">
                      {assignment.icon}
                    </span>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15px] font-semibold text-gray-900">
                        {assignment.title}
                      </h3>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">
                        {assignment.meta}
                      </p>
                    </div>

                    <div className="flex w-full items-center justify-end gap-4 sm:w-auto">
                      {assignment.progress !== null && (
                        <ProgressBar
                          value={assignment.progress}
                          size="sm"
                          label={assignment.title}
                          className="min-w-[100px] flex-1 sm:w-32 sm:flex-none"
                        />
                      )}
                      <Link
                        href={assignment.href}
                        className={cn(
                          "kg-press kg-label inline-flex min-h-[40px] shrink-0 items-center rounded-lg bg-primary px-4 font-medium text-white hover:bg-primary-dark"
                        )}
                      >
                        {assignment.cta}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ========================================= Docked assistant */}
        <aside className="min-w-0">
          <div className="xl:sticky xl:top-[96px]">
            <AssistantChat
              craftType={identity.craftType}
              seedQuestion={seed}
              className="h-[560px] rounded-3xl border border-gray-200/70 shadow-card xl:h-[calc(100vh-140px)]"
            />
          </div>
        </aside>
      </div>
    </Shell>
  );
}
