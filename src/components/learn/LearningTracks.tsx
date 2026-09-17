"use client";

import { Briefcase, Check, ExternalLink, Palette, Smartphone, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { LEARNING_TRACKS, type LearningTrack } from "@/lib/learningCatalog";
import { youtubeSearchUrl, type LearningItem, type LearningSource, type LearningTracks as Tracks } from "@/lib/learningPlan";
import type { LearningLevel } from "@/lib/skillStage";
import type { LearningOrigin } from "@/lib/useLearningPlan";
import { Badge } from "@/components/ui/Badge";
import { SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import { fill, passportStamp } from "@/components/buyer/passportFormat";
import { cn } from "@/lib/utils";

/**
 * The three learning tracks: business, design, digital.
 *
 * Each card is a topic, a reason, and a link to a live YouTube *search* for it —
 * never a video, a channel, a duration or a thumbnail, because nothing here has
 * seen one. The art is a lucide icon on a token-coloured block. The footnote
 * says where the suggestions came from (the AI, the standard catalogue, or both)
 * and, when the network failed, that this is the copy saved on the phone.
 */

const TRACK_META: Record<LearningTrack, { labelKey: string; icon: React.ReactNode; block: string }> = {
  business: {
    labelKey: "learn_track_business",
    icon: <Briefcase size={22} strokeWidth={1.6} aria-hidden />,
    block: "bg-[var(--color-pink)] text-[var(--color-maroon)]",
  },
  design: {
    labelKey: "learn_track_design",
    icon: <Palette size={22} strokeWidth={1.6} aria-hidden />,
    block: "bg-[var(--color-cream)] text-[var(--color-rust-deep)]",
  },
  digital: {
    labelKey: "learn_track_digital",
    icon: <Smartphone size={22} strokeWidth={1.6} aria-hidden />,
    block: "bg-[var(--color-pill)] text-gray-800",
  },
};

const LEVEL_KEYS: Record<LearningLevel, string> = {
  basic: "learn_level_basic",
  growing: "learn_level_growing",
  advanced: "learn_level_advanced",
};

export function LearningTracks({
  tracks,
  completed,
  pendingKey,
  source,
  mixed,
  origin,
  generatedAt,
  showingSaved,
  craftType,
  saveError,
  onStart,
  onToggle,
  onDismissError,
}: {
  tracks: Tracks | null;
  completed: string[];
  pendingKey: string | null;
  source: LearningSource;
  mixed: boolean;
  origin: LearningOrigin | null;
  generatedAt: string | null;
  showingSaved: boolean;
  /** The artisan's own craft, or empty when they have not set one. */
  craftType: string;
  saveError: boolean;
  onStart: (item: LearningItem) => void;
  onToggle: (item: LearningItem) => void;
  onDismissError: () => void;
}) {
  const { t } = useLanguage();
  const craft = craftType.trim() || t("learn_generic_craft");

  const textOf = (item: LearningItem) =>
    item.source === "AI"
      ? { title: item.title, why: item.whyItHelps, query: item.searchQuery }
      : { title: t(item.titleKey), why: t(item.whyKey), query: fill(t(item.queryKey), { craft }) };

  return (
    <section className="mt-14" aria-labelledby="learn-paths-heading">
      <SectionHeading id="learn-paths-heading">{t("learn_paths_title")}</SectionHeading>
      <p className="-mt-1 mb-6 max-w-2xl text-[14px] leading-relaxed text-gray-600">{t("learn_paths_lede")}</p>

      {saveError && (
        <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <span>{t("learn_save_failed")}</span>
          <button
            type="button"
            onClick={onDismissError}
            aria-label={t("close_btn")}
            className="kg-press -m-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      {!tracks ? (
        <div className="space-y-4" aria-hidden>
          {LEARNING_TRACKS.map((track) => (
            <div key={track} className="kg-shimmer h-[220px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {LEARNING_TRACKS.map((track) => {
            const meta = TRACK_META[track];
            const headingId = `learn-track-${track}`;
            return (
              <section key={track} aria-labelledby={headingId}>
                <SectionHeading id={headingId} size="sm">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-gray-500">{meta.icon}</span>
                    {t(meta.labelKey)}
                  </span>
                </SectionHeading>
                <ul className="kg-rail -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                  {tracks[track].map((item) => {
                    const { title, why, query } = textOf(item);
                    const href = youtubeSearchUrl(query);
                    const done = completed.includes(item.key);
                    const pending = pendingKey === item.key;
                    return (
                      <li
                        key={item.key}
                        className="flex w-[272px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-card shadow-card"
                      >
                        <div className={cn("relative flex h-20 items-center justify-center", meta.block)}>
                          {meta.icon}
                          {done && (
                            <span className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white">
                              <Check size={14} aria-hidden />
                            </span>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <SectionEyebrow tone={track === "business" ? "rust" : "maroon"} as="span">
                              {t(meta.labelKey)}
                            </SectionEyebrow>
                            <Badge variant="outline">{t(LEVEL_KEYS[item.level])}</Badge>
                          </div>
                          <h3 className="kg-display mt-2 text-[17px] leading-snug text-gray-900 [overflow-wrap:anywhere]">{title}</h3>
                          {why && (
                            <div className="mt-2">
                              <p className="kg-label text-gray-500">{t("learn_why_helps")}</p>
                              <p className="mt-1 text-[13px] leading-relaxed text-gray-600 [overflow-wrap:anywhere]">{why}</p>
                            </div>
                          )}
                          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                            {href && (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => onStart(item)}
                                aria-label={`${t("learn_watch_youtube")}: ${title} (${t("learn_opens_new_tab")})`}
                                className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white hover:bg-primary-dark"
                              >
                                {t("learn_watch_youtube")} <ExternalLink size={13} aria-hidden />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => onToggle(item)}
                              disabled={pending}
                              aria-pressed={done}
                              className={cn(
                                "kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-semibold disabled:opacity-60",
                                done
                                  ? "border-transparent bg-[var(--color-pill)] text-gray-900"
                                  : "border-gray-300 bg-card text-gray-800 hover:bg-gray-50"
                              )}
                            >
                              {done && <Check size={14} aria-hidden />}
                              {done ? t("learn_done") : t("learn_mark_done")}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {tracks && (
        <div className="mt-6 space-y-1.5 text-[12px] leading-relaxed text-gray-500">
          <p>
            {source === "AI"
              ? t(mixed ? "learn_source_mixed" : "learn_source_ai")
              : fill(t("learn_source_curated"), { craft })}
          </p>
          {showingSaved && generatedAt && (
            <p role="status" aria-live="polite">
              {fill(t("learn_offline_cached"), { date: passportStamp(generatedAt) })}
            </p>
          )}
          {origin === "fallback" && (
            <p role="status" aria-live="polite">
              {t("learn_offline_fallback")}
            </p>
          )}
          <p>{t("learn_youtube_note")}</p>
        </div>
      )}
    </section>
  );
}
