"use client";

import {
  BadgeCheck,
  Camera,
  Check,
  CircleDashed,
  CircleSlash,
  CreditCard,
  FileCheck2,
  Hammer,
  Package,
  QrCode,
  Store,
  Truck,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/SectionEyebrow";
import type { TimelineStep, TimelineStepKey } from "@/lib/passportFacts";
import { fill, languageName, passportStamp } from "@/components/buyer/passportFormat";

/**
 * The piece's life, in order, from real timestamps and real audit rows only
 * (src/lib/passportFacts.ts decides every state). A step with nothing behind it
 * is grey and dateless — never ticked, never given a guessed date — and a
 * waived QR check reads as waived, not as passed.
 */

const ICONS: Record<TimelineStepKey, React.ReactNode> = {
  material_sourced: <FileCheck2 size={15} />,
  crafted: <Hammer size={15} />,
  ai_quality: <Camera size={15} />,
  admin_verified: <BadgeCheck size={15} />,
  qr_attached: <QrCode size={15} />,
  listed: <Store size={15} />,
  paid: <CreditCard size={15} />,
  packed: <Package size={15} />,
  dispatched: <Truck size={15} />,
  delivered: <Check size={15} />,
};

const LABEL_KEYS: Record<TimelineStepKey, string> = {
  material_sourced: "timeline_material_sourced",
  crafted: "timeline_crafted",
  ai_quality: "timeline_ai_quality",
  admin_verified: "timeline_admin_verified",
  qr_attached: "timeline_qr_attached",
  listed: "timeline_listed",
  paid: "timeline_paid",
  packed: "timeline_packed",
  dispatched: "timeline_dispatched",
  delivered: "timeline_delivered",
};

function detailLine(step: TimelineStep, t: (key: string) => string): string | null {
  if (step.state !== "DONE") return null;
  switch (step.key) {
    case "material_sourced":
      return t("timeline_bill_on_file");
    case "crafted": {
      const language = typeof step.detail.language === "string" ? languageName(step.detail.language, t) : null;
      if (step.detail.method === "VOICE") {
        return language ? fill(t("story_catalogued_by_voice"), { language }) : t("story_catalogued_by_voice_plain");
      }
      if (step.detail.method === "IVR") {
        return language ? fill(t("story_catalogued_by_phone"), { language }) : t("story_catalogued_by_phone_plain");
      }
      return null;
    }
    case "ai_quality":
      return typeof step.detail.score === "number" ? fill(t("timeline_ai_quality_score"), { score: step.detail.score }) : null;
    case "listed":
      return typeof step.detail.channels === "number" && step.detail.channels > 0
        ? fill(t("timeline_listed_channels"), { n: step.detail.channels })
        : null;
    default:
      return null;
  }
}

export function ProvenanceTimeline({ steps }: { steps: TimelineStep[] }) {
  const { t } = useLanguage();

  return (
    <section aria-labelledby="passport-timeline">
      <SectionHeading id="passport-timeline" size="sm">
        {t("timeline_title")}
      </SectionHeading>
      <ol className="kg-stagger relative mt-2">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const detail = detailLine(step, t);
          return (
            <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[17px] top-9 h-[calc(100%-2.25rem)] w-px",
                    step.state === "DONE" ? "bg-gray-900/40" : "bg-gray-200"
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  step.state === "DONE" && "bg-primary text-white",
                  step.state === "WAIVED" && "border-2 border-[var(--color-rust)] bg-card text-[var(--color-rust)]",
                  step.state === "PENDING" && "border border-dashed border-gray-300 bg-card text-gray-400"
                )}
              >
                {step.state === "WAIVED" ? <CircleSlash size={15} /> : step.state === "PENDING" ? <CircleDashed size={15} /> : ICONS[step.key]}
              </span>
              <div className="min-w-0 flex-1 pt-1.5">
                <p className={cn("text-[14px] font-semibold", step.state === "PENDING" ? "text-gray-400" : "text-gray-900")}>
                  {step.state === "WAIVED" ? t("timeline_qr_waived") : t(LABEL_KEYS[step.key])}
                </p>
                {step.state === "PENDING" ? (
                  <p className="mt-0.5 text-[12px] text-gray-400">{t("timeline_pending")}</p>
                ) : (
                  <>
                    {step.at && <time className="mt-0.5 block text-[12px] text-gray-600" dateTime={step.at}>{passportStamp(step.at)}</time>}
                    {detail && <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600">{detail}</p>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
