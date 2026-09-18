"use client";

import { useEffect, useId, useState } from "react";
import {
  Clock,
  HandHeart,
  Lock,
  Mic,
  Package,
  Scale,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { fill } from "@/components/buyer/passportFormat";
import { SkillStageCard } from "@/components/learn/SkillStageCard";
import { BADGES, type BadgeGap, type BadgeKey } from "@/lib/badges";
import {
  BENCHMARK_METRIC_LABEL_KEYS,
  type BenchmarkMetric,
  type BenchmarkMetricKey,
  type BenchmarkResult,
} from "@/lib/clusterBenchmark";
import type { StageEarnings, StageInputs, StageResult } from "@/lib/skillStage";

/**
 * "Where I stand": skill stage, earned badges, and an anonymous comparison with
 * the artisans around them — one block, because those three answer one question.
 *
 * Two rules the markup here exists to keep:
 *
 *   1. **No mystery badges.** A badge the artisan has not earned shows the real
 *      remaining gap from their own figures, never a silhouette.
 *   2. **No leaderboard.** The comparison is medians against a cohort that must
 *      be at least `minCohort` artisans, it names nobody, and below the
 *      threshold it says so — with the real cohort size and the threshold —
 *      rather than showing a number from too few people.
 */

const BADGE_ICONS: Record<BadgeKey, React.ComponentType<{ size?: number; className?: string }>> = {
  FIRST_SALE: Sparkles,
  TEN_SALES: Package,
  REPEAT_MAGNET: Users,
  FAIR_WAGE_KEEPER: Scale,
  VERIFIED_TEN: ShieldCheck,
  ON_TIME_FIVE: Clock,
  CLUSTER_HELPER: HandHeart,
  VOICE_PIONEER: Mic,
};

const LABEL_KEY: Record<BadgeKey, string> = Object.fromEntries(
  BADGES.map((badge) => [badge.key, badge.labelKey])
) as Record<BadgeKey, string>;

/**
 * The basis figure names `badges.ts` freezes, and the sentence each one reads.
 *
 * Two of them can legitimately be 1 — the very first sale is the point of
 * FIRST_SALE, and one returning buyer earns REPEAT_MAGNET — so those carry a
 * singular form. The rest have a threshold of three or more and cannot be 1.
 */
const BASIS_KEY: Record<string, string> = {
  sales: "badge_basis_sales",
  repeatBuyers: "badge_basis_repeat_buyers",
  listings: "badge_basis_listings",
  verifiedScans: "badge_basis_verified",
  delivered: "badge_basis_delivered",
  requestsAccepted: "badge_basis_requests",
  voiceItems: "badge_basis_voice",
};

const BASIS_SINGULAR = new Set(["sales", "repeatBuyers"]);

function basisKey(name: string, count: number): string | null {
  const key = BASIS_KEY[name];
  if (!key) return null;
  return count === 1 && BASIS_SINGULAR.has(name) ? `${key}_one` : key;
}

const IST_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
};

interface EarnedBadge {
  key: BadgeKey;
  awardedAt: string;
  basis: Record<string, number>;
}

interface RecognitionPayload {
  stage: { inputs: StageInputs; earnings: StageEarnings; result: StageResult };
  badges: { earned: EarnedBadge[]; locked: BadgeGap[] };
}

interface BenchmarkPayload {
  result: BenchmarkResult;
  windowDays: number;
  ownOfflineMonthly: number;
  ownPlatformIdle: boolean;
  locationResolved: boolean;
}

export function RecognitionPanel() {
  const { t } = useLanguage();
  const [recognition, setRecognition] = useState<RecognitionPayload | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let alive = true;
    // Deferred kickoff: the panel is below the fold on the dashboard and its
    // evaluation writes badge rows, so it must never compete with first paint.
    const timer = setTimeout(async () => {
      try {
        const [mine, peers] = await Promise.all([
          fetch("/api/artisan/recognition", { cache: "no-store" }),
          fetch("/api/artisan/benchmarks", { cache: "no-store" }),
        ]);
        const recognitionJson = await mine.json();
        if (!mine.ok || !recognitionJson?.success) throw new Error(recognitionJson?.error || `HTTP ${mine.status}`);
        if (!alive) return;
        setRecognition(recognitionJson as RecognitionPayload);

        // The comparison is the optional half: a failure there leaves the
        // badges on screen rather than blanking the whole block.
        const benchmarkJson = await peers.json().catch(() => null);
        if (alive && peers.ok && benchmarkJson?.success) setBenchmark(benchmarkJson as BenchmarkPayload);
        if (alive) setState("ready");
      } catch (error) {
        console.warn("[recognition] unavailable:", (error as Error)?.message);
        if (alive) setState("failed");
      }
    }, 0);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  if (state === "failed") return null;

  return (
    <Card as="section" pad="lg" radius="3xl" className="kg-enter min-w-0" aria-labelledby="recognition-heading">
      <div className="flex items-start gap-3">
        <Trophy size={20} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0">
          <h2 id="recognition-heading" className="kg-display text-[26px] leading-tight text-gray-900">
            {t("recognition_title")}
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-gray-500">{t("recognition_lede")}</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <SkillStageCard
          stage={recognition?.stage.result ?? null}
          inputs={recognition?.stage.inputs ?? null}
          earnings={recognition?.stage.earnings ?? null}
          loading={state === "loading"}
        />

        {state === "loading" ? (
          <div className="kg-shimmer h-[96px] rounded-2xl" aria-hidden />
        ) : (
          <BadgeSection earned={recognition?.badges.earned ?? []} locked={recognition?.badges.locked ?? []} />
        )}

        {state === "loading" ? (
          <div className="kg-shimmer h-[140px] rounded-2xl" aria-hidden />
        ) : (
          benchmark && <BenchmarkSection payload={benchmark} />
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------- badges

function BadgeSection({ earned, locked }: { earned: EarnedBadge[]; locked: BadgeGap[] }) {
  const { t } = useLanguage();

  return (
    <section aria-label={t("badge_section_title")}>
      <SectionEyebrow>{t("badge_section_title")}</SectionEyebrow>

      {earned.length === 0 ? (
        <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t("badge_none_yet")}</p>
      ) : (
        <ul className="kg-rail -mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1">
          {earned.map((badge) => (
            <li key={badge.key} className="shrink-0">
              <EarnedChip badge={badge} />
            </li>
          ))}
        </ul>
      )}

      {locked.length > 0 && (
        <>
          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            {t("badge_locked_title")}
          </p>
          <ul className="mt-2 space-y-2">
            {locked.map((gap) => (
              <LockedRow key={gap.key} gap={gap} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function EarnedChip({ badge }: { badge: EarnedBadge }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Icon = BADGE_ICONS[badge.key];

  // The frozen figures, in the order badges.ts wrote them. "12 sales" is what
  // was true the day it was earned, not today's count.
  const basis = Object.entries(badge.basis)
    .map(([name, value]) => {
      const key = basisKey(name, value);
      return key ? fill(t(key), { count: value }) : null;
    })
    .filter((line): line is string => Boolean(line));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex min-h-[44px] items-center gap-2 rounded-2xl border px-3 py-2 text-left transition",
          open ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-gray-50 hover:border-amber-200"
        )}
      >
        <Icon size={16} className="shrink-0 text-amber-600" aria-hidden />
        <span className="text-[13px] font-semibold text-gray-900">{t(LABEL_KEY[badge.key])}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-2 max-w-[220px] rounded-xl bg-gray-50 p-2.5 text-[12px] leading-relaxed text-gray-600">
          {basis.length > 0 && <p>{fill(t("badge_earned_with"), { basis: basis.join(", ") })}</p>}
          <p className="mt-1 text-gray-500">
            {fill(t("badge_earned_on"), { date: new Date(badge.awardedAt).toLocaleString("en-IN", IST_DAY) })}
          </p>
        </div>
      )}
    </>
  );
}

function LockedRow({ gap }: { gap: BadgeGap }) {
  const { t } = useLanguage();
  const Icon = BADGE_ICONS[gap.key];

  return (
    <li className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
      <span className="relative shrink-0">
        <Icon size={16} className="text-gray-400" aria-hidden />
        <Lock size={10} className="absolute -bottom-1 -right-1 text-gray-500" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-gray-700">{t(LABEL_KEY[gap.key])}</span>
        <span className="block text-[12px] text-gray-500">
          {fill(t(gap.gapKey), { have: gap.have, need: gap.need })}
        </span>
      </span>
      <span className="w-16 shrink-0">
        <ProgressBar value={gap.have} max={gap.need} size="sm" tone="neutral" label={t(LABEL_KEY[gap.key])} />
      </span>
    </li>
  );
}

// --------------------------------------------------------------- benchmarks

const SCOPE_KEY = {
  CLUSTER: "benchmark_scope_cluster",
  REGION: "benchmark_scope_region",
} as const;

/**
 * The coarsest position the payload carries, and the coarsest this screen will
 * say out loud: which quartile band, never a rank and never a place.
 */
const POSITION_KEY = {
  BELOW: "benchmark_position_below",
  MIDDLE: "benchmark_position_middle",
  ABOVE: "benchmark_position_above",
} as const;

/** Rupees for money, one decimal for pieces, a percent for a rate. */
function formatMetric(key: BenchmarkMetricKey, value: number): string {
  if (key === "monthlyEarnings" || key === "avgPrice") return formatRupees(value);
  if (key === "fulfilment") return `${Math.round(value)}%`;
  return String(value);
}

function BenchmarkSection({ payload }: { payload: BenchmarkPayload }) {
  const { t } = useLanguage();
  const { result } = payload;

  return (
    <section aria-label={t("benchmark_title")}>
      <SectionEyebrow>{t("benchmark_title")}</SectionEyebrow>

      {!result.available ? (
        <Card tone="muted" pad="md" className="mt-3">
          <p className="text-[14px] leading-relaxed text-gray-700">
            {fill(t("benchmark_unavailable"), { cohort: result.cohortSize, min: result.minCohort })}
          </p>
          {!payload.locationResolved && (
            <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t("benchmark_no_location")}</p>
          )}
        </Card>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-[13px] text-gray-600">
            {fill(t("benchmark_cohort"), {
              count: result.cohortSize,
              scope: t(SCOPE_KEY[result.scope]),
              days: payload.windowDays,
            })}
          </p>
          <ul className="space-y-3">
            {result.metrics.map((metric) => (
              <MetricRow key={metric.key} metric={metric} />
            ))}
          </ul>
        </div>
      )}

      {payload.ownOfflineMonthly > 0 && (
        <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
          {fill(t("benchmark_offline_note"), { amount: formatRupees(payload.ownOfflineMonthly) })}
        </p>
      )}
      {payload.ownPlatformIdle && (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t("benchmark_platform_idle")}</p>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        {fill(t("benchmark_privacy_note"), { min: result.minCohort })}
      </p>
    </section>
  );
}

function MetricRow({ metric }: { metric: BenchmarkMetric }) {
  const { t } = useLanguage();
  const label = t(BENCHMARK_METRIC_LABEL_KEYS[metric.key]);
  // Both bars share one scale — the larger of the two figures — so the visual
  // comparison matches the numbers instead of flattering whichever is drawn
  // first. A zero pair leaves both bars empty rather than dividing by zero.
  const max = Math.max(metric.you, metric.median, 1);

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-gray-800">{label}</span>
        <span className="text-[11px] text-gray-500">
          {t(POSITION_KEY[metric.position])} · {fill(t("benchmark_peers"), { count: metric.peers })}
        </span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        <BenchmarkBar
          caption={t("benchmark_you")}
          value={metric.you}
          max={max}
          text={formatMetric(metric.key, metric.you)}
          tone="primary"
          label={`${label} — ${t("benchmark_you")}`}
        />
        <BenchmarkBar
          caption={t("benchmark_median")}
          value={metric.median}
          max={max}
          text={formatMetric(metric.key, metric.median)}
          tone="neutral"
          label={`${label} — ${t("benchmark_median")}`}
        />
      </div>
    </li>
  );
}

function BenchmarkBar({
  caption,
  value,
  max,
  text,
  tone,
  label,
}: {
  caption: string;
  value: number;
  max: number;
  text: string;
  tone: "primary" | "neutral";
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-14 shrink-0 text-[11px] text-gray-500">{caption}</span>
      <ProgressBar value={value} max={max} tone={tone} size="sm" label={label} className="min-w-0 flex-1" />
      <span className="w-[76px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-gray-800">
        {text}
      </span>
    </div>
  );
}
