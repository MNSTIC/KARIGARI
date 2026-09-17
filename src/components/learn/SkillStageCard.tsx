"use client";

import { useId, useState } from "react";
import { Award, ChevronDown, CloudOff, Sprout, TrendingUp } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import {
  requirementsFor,
  type SkillStage,
  type StageEarnings,
  type StageInputs,
  type StageRequirement,
  type StageResult,
} from "@/lib/skillStage";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { fill } from "@/components/buyer/passportFormat";
import { cn } from "@/lib/utils";

/**
 * The skill-stage chip and the bar toward the next stage.
 *
 * The bar is `StageResult.progress`: the requirement furthest from done, never
 * an average, and the card says so. Tapping the chip opens the real have/need
 * for every unmet requirement — for a beginner, the Pro requirements too, so a
 * new artisan sees the whole ladder rather than only its first rung.
 */

const STAGE_KEYS: Record<SkillStage, string> = {
  BEGINNER: "learn_stage_beginner",
  INTERMEDIATE: "learn_stage_intermediate",
  PRO: "learn_stage_pro",
};

const STAGE_ICONS: Record<SkillStage, React.ReactNode> = {
  BEGINNER: <Sprout size={13} aria-hidden />,
  INTERMEDIATE: <TrendingUp size={13} aria-hidden />,
  PRO: <Award size={13} aria-hidden />,
};

export function SkillStageCard({
  stage,
  inputs,
  earnings,
  loading,
}: {
  stage: StageResult | null;
  inputs: StageInputs | null;
  earnings: StageEarnings | null;
  /** Nothing read yet — neither a saved copy nor the network. */
  loading: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (loading) {
    return <div className="kg-shimmer h-[112px] rounded-2xl" aria-hidden />;
  }

  if (!stage || !inputs) {
    return (
      <Card tone="muted" pad="md" className="flex items-start gap-3">
        <CloudOff size={18} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
        <div className="min-w-0">
          <SectionEyebrow>{t("learn_stage_label")}</SectionEyebrow>
          <p className="mt-1 text-[14px] leading-relaxed text-gray-700">{t("learn_stage_offline")}</p>
        </div>
      </Card>
    );
  }

  const next = stage.nextStage;
  // A beginner's next rung is Intermediate; show the rung after it as well.
  const later: StageRequirement[] =
    stage.stage === "BEGINNER" ? requirementsFor("PRO", inputs).filter(({ have, need }) => have < need) : [];

  return (
    <Card pad="md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <SectionEyebrow>{t("learn_stage_label")}</SectionEyebrow>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={panelId}
            className="kg-press mt-2 inline-flex min-h-[40px] items-center gap-2 rounded-full"
          >
            <Badge variant={stage.stage === "PRO" ? "solid" : "mint"} icon={STAGE_ICONS[stage.stage]} className="px-3 py-2 text-[13px]">
              {t(STAGE_KEYS[stage.stage])}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-600 underline underline-offset-2">
              {open ? t("learn_stage_hide") : t("learn_stage_show")}
              <ChevronDown size={14} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
            </span>
          </button>
        </div>
      </div>

      <div className="mt-4">
        {next ? (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-medium text-gray-800">{fill(t("learn_stage_progress"), { stage: t(STAGE_KEYS[next]) })}</span>
              <span className="kg-label shrink-0 text-gray-500">{Math.floor(stage.progress * 100)}%</span>
            </div>
            <ProgressBar
              value={stage.progress}
              max={1}
              className="mt-2"
              label={fill(t("learn_stage_progress"), { stage: t(STAGE_KEYS[next]) })}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">{t("learn_stage_progress_note")}</p>
          </>
        ) : (
          <>
            <ProgressBar value={1} max={1} tone="success" label={t("learn_stage_top")} />
            <p className="mt-2 text-[13px] text-gray-700">{t("learn_stage_top")}</p>
          </>
        )}
      </div>

      <div id={panelId} hidden={!open} className="mt-4 border-t border-gray-200 pt-4">
        {next ? (
          <>
            <RequirementList
              title={fill(t("learn_stage_next_title"), { stage: t(STAGE_KEYS[next]) })}
              requirements={stage.nextRequirements}
              earnings={earnings}
            />
            {later.length > 0 && (
              <div className="mt-4">
                <RequirementList
                  title={fill(t("learn_stage_then_title"), { stage: t(STAGE_KEYS.PRO) })}
                  requirements={later}
                  earnings={earnings}
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-gray-600">{t("learn_stage_top_body")}</p>
        )}
        <p className="mt-4 text-[12px] leading-relaxed text-gray-500">{t("learn_stage_basis")}</p>
      </div>
    </Card>
  );
}

function RequirementList({
  title,
  requirements,
  earnings,
}: {
  title: string;
  requirements: StageRequirement[];
  earnings: StageEarnings | null;
}) {
  const { t } = useLanguage();
  return (
    <>
      <h3 className="text-[14px] font-semibold text-gray-900">{title}</h3>
      <ul className="mt-2 space-y-3">
        {requirements.map((requirement) => {
          const money = requirement.key === "realisedEarnings";
          const show = (value: number) => (money ? formatRupees(value) : String(value));
          const line = fill(t(requirement.labelKey), {
            have: show(requirement.have),
            need: show(requirement.need),
            more: show(Math.max(0, requirement.need - requirement.have)),
          });
          return (
            <li key={requirement.key}>
              <p className="text-[13px] leading-snug text-gray-800">{line}</p>
              <ProgressBar value={requirement.have} max={requirement.need} size="sm" className="mt-1.5" label={line} />
              {money && earnings && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
                  {fill(t("learn_earnings_streams"), {
                    platform: formatRupees(earnings.platform),
                    demand: formatRupees(earnings.demand),
                    offline: formatRupees(earnings.offline),
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
