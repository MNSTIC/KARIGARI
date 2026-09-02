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
import { useArtisanIdentity } from "@/lib/artisanIdentity";
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
 */

/** Technique prompts, phrased for the artisan's own craft at render time. */
const MASTERCLASSES: { id: string; label: string; title: string; ask: string; icon: React.ReactNode }[] = [
  {
    id: "finish",
    label: "Technique",
    title: "A sharper, more even finish",
    ask: "Show me a tutorial on getting a sharper, more even finish on my {craft}.",
    icon: <Palette size={18} strokeWidth={1.6} />,
  },
  {
    id: "pattern",
    label: "Design",
    title: "Advanced pattern and motif work",
    ask: "Teach me a more advanced pattern or design technique used in {craft}.",
    icon: <Sparkles size={18} strokeWidth={1.6} />,
  },
  {
    id: "material",
    label: "Materials",
    title: "Preparing and handling raw material",
    ask: "How should I prepare and handle my raw materials for {craft} so less is wasted?",
    icon: <Boxes size={18} strokeWidth={1.6} />,
  },
  {
    id: "pricing",
    label: "Business",
    title: "Pricing your craft fairly",
    ask: "Explain how I should price my craft so I am paid fairly for my time and materials.",
    icon: <IndianRupee size={18} strokeWidth={1.6} />,
  },
  {
    id: "selling",
    label: "Digital Skills",
    title: "Selling beyond your district",
    ask: "What do I need to know to sell my craft online to buyers outside my district?",
    icon: <TrendingUp size={18} strokeWidth={1.6} />,
  },
];

interface Assignment {
  id: string;
  title: string;
  meta: string;
  progress: number;
  cta: string;
  href: string;
  icon: React.ReactNode;
}

export default function LearnPage() {
  const { t } = useLanguage();
  const identity = useArtisanIdentity();
  const craft = identity.craftType || t("your_craft");

  const [seed, setSeed] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/artisan/dashboard", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data?.success) setDashboard(data.data);
      } catch (error) {
        console.error("Failed to load your outstanding work:", error);
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
    () => MASTERCLASSES.map((entry) => ({ ...entry, ask: entry.ask.replace("{craft}", craft) })),
    [craft]
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
        title: "Finish your voice drafts",
        meta: `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} captured by phone, waiting for photos and a price`,
        progress: 35,
        cta: "Complete",
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
        title: "Attach your printed patches",
        meta: `${awaitingPatch.length} verified ${awaitingPatch.length === 1 ? "piece needs" : "pieces need"} a re-photograph before they can be listed`,
        progress: 70,
        cta: "Upload",
        href: "/artisan/dashboard",
        icon: <QrCode size={18} strokeWidth={1.6} />,
      });
    }

    const profile = dashboard.artisanProfile ?? {};
    const missing = [
      !profile.socialCategory && "social category",
      profile.annualIncome === null || profile.annualIncome === undefined ? "annual income" : null,
      !profile.aadhaarLast4 && "Aadhaar",
      !profile.upiId && "UPI ID",
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
      list.push({
        id: "profile",
        title: "Complete your eligibility profile",
        meta: `Missing ${missing.join(", ")} — these are what the scheme engine checks`,
        progress: Math.round(((4 - missing.length) / 4) * 100),
        cta: "Update",
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
        title: "Publish your sellable pieces",
        meta: `${unlisted.length} ${unlisted.length === 1 ? "piece is" : "pieces are"} verified and ready to go on the marketplace`,
        progress: 85,
        cta: "List",
        href: "/artisan/dashboard",
        icon: <TrendingUp size={18} strokeWidth={1.6} />,
      });
    }

    return list;
  }, [dashboard]);

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
                Elevate Your Craft with AI
              </h1>
              <p className="mt-4 text-[15px] leading-relaxed text-white/75">
                Blend ancestral technique with modern insight. Explore new patterns, understand
                what the market is paying, and sharpen the skills behind your {craft}.
              </p>
              <button
                onClick={() => setSeed("")}
                className="kg-press kg-label mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-6 font-medium text-gray-900 hover:bg-gray-100"
              >
                Start learning <ArrowRight size={14} />
              </button>
            </div>
          </section>

          {/* ------------------------------------------ Masterclasses */}
          <section className="mt-14">
            {/* No "View all": every masterclass this page has is already on it,
                and the link used to point at the AI Hub, which no longer
                exists. A CTA to a destination that does not exist is worse
                than no CTA. */}
            <SectionHeading>Masterclasses</SectionHeading>

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
                      Live lesson
                    </span>
                  </div>

                  <div className="p-5">
                    <SectionEyebrow tone={entry.label === "Business" ? "rust" : "maroon"}>
                      {entry.label}
                    </SectionEyebrow>
                    <h3 className="kg-display mt-2 text-[19px] leading-snug text-gray-900">
                      {entry.title}
                    </h3>
                    <p className="mt-2 flex items-center gap-2 text-[13px] text-gray-500">
                      <span className="text-gray-400">{entry.icon}</span>
                      Asks the assistant about your {craft}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* --------------------------------------- Active assignments */}
          <section className="mt-14">
            <SectionHeading>Active Assignments</SectionHeading>

            {loading ? (
              <div className="space-y-4">
                {[0, 1].map((i) => (
                  <div key={i} className="kg-shimmer h-[92px] rounded-2xl" />
                ))}
              </div>
            ) : assignments.length === 0 ? (
              <Card tone="muted" pad="lg" className="text-[14px] leading-relaxed text-gray-600">
                Nothing is outstanding — every draft is finished, every verified piece carries its
                patch, and your eligibility profile is complete. Capture something new when you are
                ready.
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

                    <div className="flex w-full items-center gap-4 sm:w-auto">
                      <ProgressBar
                        value={assignment.progress}
                        size="sm"
                        label={assignment.title}
                        className="min-w-[100px] flex-1 sm:w-32 sm:flex-none"
                      />
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
