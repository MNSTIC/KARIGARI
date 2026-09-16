"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { Camera, Check, Info, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import en from "@/lib/i18n/en";
import { assessPhotoLocally } from "@/lib/photoQuality";
import type { RetakeAdvice } from "@/lib/photoGate";
import {
  buildPhotoVariants,
  makeVariantThumbnail,
  shrinkCutout,
  type BackgroundRemovalMode,
  type PhotoVariant,
} from "@/lib/imageEnhance";
import type {
  PhotoQualitySource,
  PhotoStudioFields,
  StoredImageVariants,
} from "@/lib/photoStudioPayload";

/**
 * V11 AI Photo Studio — step 2 of the capture modal.
 *
 * Three phases inside the existing panel, never a fourth step:
 *   1. CHECKING   on-device blur/exposure pre-check (instant, offline, warns
 *                 only), then the server verdict from /api/items/vision-verify.
 *   2. RETAKE     only when that verdict is RETAKE: the specific reason, a
 *                 Retake button and an equally weighted "Use this photo
 *                 anyway". Never a dead end. After one retake the server gate
 *                 stops asking, whatever the score.
 *   3. THE LOOK   every variant from `buildPhotoVariants()`, Original first,
 *                 as an arrow-key radiogroup. The pick becomes `images[0]`.
 *
 * The pipeline lives in `usePhotoStudio`, which CaptureModal owns, so a look
 * that is still rendering keeps rendering when the artisan moves on to set a
 * price — `<PhotoStudio>` below is presentation only.
 *
 * Verification runs on the CAMERA FRAME, before any look exists. The listing
 * photo may become a studio composite, but every authenticity comparator reads
 * `originalImageUrl` (see `provenanceReference()` in src/lib/buyerVerify.ts).
 */

export const PHOTO_STUDIO_ENABLED = process.env.NEXT_PUBLIC_PHOTO_STUDIO_ENABLED !== "false";

export type StudioPhase = "idle" | "checking" | "retake" | "building" | "ready";

export interface StudioVerdict {
  advice: RetakeAdvice;
  /** i18n key; '' on a silent pass. */
  reasonKey: string;
  source: PhotoQualitySource;
  /** Only when `source === 'AI'` — a fallback never carries a number. */
  score: number | null;
  /** The vision check did not run at all (5xx, offline). */
  unavailable: boolean;
  match: boolean;
  craftDetails: string;
  recommendedBg: string;
  display: string;
  descriptionEnglish: string;
  descriptionLocal: string;
}

interface GalleryVariant extends PhotoVariant {
  /** ≤320 px JPEG, what the gallery draws and what `imageVariants` stores. */
  thumb: string;
  order: number;
}

export interface StudioState {
  /** The photo this state describes; a different `images[0]` starts over. */
  photo: string | null;
  phase: StudioPhase;
  /** On-device hint (i18n key), shown while the server check runs. */
  localHint: string;
  verdict: StudioVerdict | null;
  buildStep: "enhancing" | "removing_background" | "composing" | null;
  variants: GalleryVariant[];
  selectedKey: string;
  mode: BackgroundRemovalMode | null;
  /** ≤900 px PNG kept for re-rendering presets later; null when none. */
  storedCutout: string | null;
  /** A cutout was produced but cut into the craft, so it was discarded. */
  cutoutRejected: boolean;
  usedAnyway: boolean;
}

const INITIAL: StudioState = {
  photo: null,
  phase: "idle",
  localHint: "",
  verdict: null,
  buildStep: null,
  variants: [],
  selectedKey: "ORIGINAL",
  mode: null,
  storedCutout: null,
  cutoutRejected: false,
  usedAnyway: false,
};

/**
 * The generative tier, per page session. A free-tier key answers `no_quota`
 * (measured `limit: 0`) on every call, so after the first such answer every
 * later capture skips the request instead of paying its latency again.
 */
let generativeTierOpen = true;

/**
 * Request-body ceiling on the client. Vercel refuses a function body over
 * 4.5 MB; the listing photos alone can approach 2 MB of base64, so optional
 * studio data is shed — cutout first, then thumbnails, then the enhanced
 * frame — until the capture fits. The capture itself is never shed.
 */
const CLIENT_BODY_BUDGET = 3_800_000;

interface UsePhotoStudioArgs {
  enabled: boolean;
  /** `images[0]` — already downscaled at capture time. */
  photo: string | undefined;
  description: string;
  craftType: string;
  language: string;
  retakeCount: number;
  /** Called once per photo, when the flow proceeds past the check. */
  onVerified: (verdict: StudioVerdict) => void;
}

function englishFor(key: string): string {
  return (en as Record<string, string>)[key] ?? "";
}

export function usePhotoStudio({
  enabled,
  photo,
  description,
  craftType,
  language,
  retakeCount,
  onVerified,
}: UsePhotoStudioArgs) {
  const [stored, setState] = useState<StudioState>(INITIAL);

  // Derived, not reset in an effect: state that belongs to a different photo
  // (or to a studio that is switched off) simply is not shown.
  const state: StudioState = useMemo(
    () =>
      enabled && photo ? (stored.photo === photo ? stored : { ...INITIAL, photo, phase: "checking" }) : INITIAL,
    [enabled, photo, stored]
  );

  // Values the pipeline reads but must not restart on: typing in the listing
  // box or switching language must never re-check the same photo.
  const inputs = useRef({ description, craftType, language, retakeCount, onVerified });
  useEffect(() => {
    inputs.current = { description, craftType, language, retakeCount, onVerified };
  });

  /** Bumped for every new photo; a stale run checks it and stops writing. */
  const runRef = useRef(0);
  const localMeasuredRef = useRef(false);

  /** Update the state for `photo`, starting from a clean slate if it is new. */
  const patch = useCallback((forPhoto: string, update: (s: StudioState) => Partial<StudioState>) => {
    setState((prev) => {
      const base = prev.photo === forPhoto ? prev : { ...INITIAL, photo: forPhoto, phase: "checking" as const };
      return { ...base, ...update(base) };
    });
  }, []);

  const build = useCallback(async (run: number, source: string, verdict: StudioVerdict) => {
    const live = () => runRef.current === run;
    let order = 0;
    patch(source, () => ({ phase: "building", buildStep: "enhancing" }));

    const generateBackdrops = async (): Promise<string[]> => {
      if (!generativeTierOpen || !verdict.craftDetails) return [];
      try {
        const res = await fetch("/api/items/backdrop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ craftDetails: verdict.craftDetails, display: verdict.display }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok && Array.isArray(data.backdrops)) return data.backdrops;
        if (data?.reason === "no_quota" || data?.reason === "unconfigured") generativeTierOpen = false;
      } catch {
        // Offline or aborted: the tier is simply absent for this photo.
      }
      return [];
    };

    const result = await buildPhotoVariants(source, {
      allowServer: true,
      onPhase: (step) => live() && patch(source, () => ({ buildStep: step })),
      onVariant: (variant) => {
        const position = order++;
        void makeVariantThumbnail(variant.dataUrl).then((thumb) => {
          if (!live()) return;
          patch(source, (s) => ({
            variants: [...s.variants, { ...variant, thumb, order: position }].sort((a, b) => a.order - b.order),
          }));
        });
      },
      generateBackdrops,
    });
    if (!live()) return;

    const storedCutout = result.cutout ? await shrinkCutout(result.cutout) : null;
    if (!live()) return;
    patch(source, () => ({
      phase: "ready",
      buildStep: null,
      mode: result.backgroundRemovalMode,
      cutoutRejected: Boolean(result.cutoutRejected),
      storedCutout,
    }));
  }, [patch]);

  // The pipeline, once per photo.
  useEffect(() => {
    const run = ++runRef.current;
    if (!enabled || !photo) return;
    const live = () => runRef.current === run;

    void (async () => {
      // 1. On-device pre-check. Never blocks, never decides on its own.
      const local = await assessPhotoLocally(photo);
      if (!live()) return;
      localMeasuredRef.current = local.measured;
      if (local.measured && local.hint) patch(photo, () => ({ localHint: local.hint }));

      // 2. Server verdict on the camera frame.
      const { description: desc, craftType: ct, language: lang, retakeCount: retakes } = inputs.current;
      let verdict: StudioVerdict;
      const offlineSource: PhotoQualitySource = local.measured ? "HEURISTIC" : "UNCHECKED";
      // A local `unusable` becomes advice, never a retake: only the server decides that.
      const localAdvice: Pick<StudioVerdict, "advice" | "reasonKey"> =
        local.measured && local.verdict === "unusable" && local.hint
          ? { advice: "SOFT", reasonKey: local.hint }
          : { advice: "PASS", reasonKey: "" };
      const unchecked = (unavailable: boolean): StudioVerdict => ({
        ...localAdvice,
        source: offlineSource,
        score: null,
        unavailable,
        match: true,
        craftDetails: desc,
        recommendedBg: "",
        display: "other",
        descriptionEnglish: desc,
        descriptionLocal: "",
      });

      try {
        const res = await fetch("/api/items/vision-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: photo,
            description: desc,
            targetLanguage: lang,
            craftType: ct,
            retakeCount: retakes,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        const data = payload?.data;
        if (!res.ok || payload?.success !== true || !data) {
          verdict = unchecked(true);
        } else if (data.scoreSource === "FALLBACK") {
          // The model answered but its reply was unreadable: no AI claim at all.
          verdict = { ...unchecked(false), craftDetails: data.craft_details || desc };
        } else {
          const score = Number(data.score);
          verdict = {
            advice: data.retakeAdvice === "RETAKE" || data.retakeAdvice === "SOFT" ? data.retakeAdvice : "PASS",
            reasonKey: typeof data.retakeReasonKey === "string" ? data.retakeReasonKey : "",
            source: "AI",
            score: Number.isFinite(score) ? score : null,
            unavailable: false,
            match: data.match !== false,
            craftDetails: (typeof data.craft_details === "string" && data.craft_details.trim()) || desc,
            recommendedBg: typeof data.recommended_bg === "string" ? data.recommended_bg : "",
            display: typeof data.display === "string" ? data.display : "other",
            descriptionEnglish: data.descriptionEnglish || desc,
            descriptionLocal: data.descriptionLocal || "",
          };
        }
      } catch {
        verdict = unchecked(true);
      }
      if (!live()) return;

      if (verdict.advice === "RETAKE") {
        patch(photo, () => ({ verdict, phase: "retake" }));
        return;
      }
      patch(photo, () => ({ verdict }));
      inputs.current.onVerified(verdict);
      await build(run, photo, verdict);
    })();

    return () => {
      // Unmount or a new photo: anything still running stops writing state.
      runRef.current += 1;
    };
  }, [enabled, photo, build, patch]);

  /** "Use this photo anyway" — proceeds, and the choice is recorded. */
  const acceptPhoto = useCallback(() => {
    if (state.phase !== "retake" || !state.verdict || !photo) return;
    const verdict = { ...state.verdict, advice: "SOFT" as const };
    patch(photo, () => ({ usedAnyway: true, verdict }));
    inputs.current.onVerified(verdict);
    void build(runRef.current, photo, verdict);
  }, [build, patch, photo, state.phase, state.verdict]);

  const select = useCallback(
    (key: string) => {
      if (!photo) return;
      patch(photo, (s) => (s.variants.some((v) => v.key === key) ? { selectedKey: key } : {}));
    },
    [patch, photo]
  );

  /**
   * The listing photo and the studio fields, for the capture payload.
   *
   * Uses whatever is ready: an artisan who saves while a look is still
   * rendering gets the Original, never a wait. `imageVariants` holds
   * THUMBNAILS plus one downscaled cutout — never full-size copies of every
   * look — and the server re-checks every cap in src/lib/photoStudioPayload.ts.
   */
  const collect = useCallback(
    (otherImages: string[]): { listingImage: string | undefined; fields: PhotoStudioFields } => {
      const s = state;
      if (!enabled || !photo) return { listingImage: photo, fields: {} };

      const byKey = (key: string) => s.variants.find((v) => v.key === key);
      const selected = byKey(s.selectedKey) ?? byKey("ORIGINAL");
      const listingImage = selected?.dataUrl ?? photo;
      const selectedKey = selected?.key ?? "ORIGINAL";
      const verdict = s.verdict;

      const notes: string[] = [];
      if (verdict?.source === "AI") {
        if (verdict.score !== null) notes.push(`AI photo check: ${verdict.score}/10.`);
        if (!verdict.match) notes.push("AI could not match this photo to the description.");
      } else if (verdict?.unavailable) {
        notes.push("The photo could not be checked automatically this time.");
      }
      if (verdict?.reasonKey) notes.push(englishFor(verdict.reasonKey));
      if (s.usedAnyway) notes.push("The artisan chose to use this photo after being advised to retake it.");
      if (s.cutoutRejected) notes.push("Background removal would have cut into the craft, so the full photo was kept.");

      const source: PhotoQualitySource =
        verdict?.source ?? (localMeasuredRef.current ? "HEURISTIC" : "UNCHECKED");

      let imageVariants: StoredImageVariants | null = s.variants.length
        ? {
            v: 1,
            variants: s.variants.map(({ key, label, kind, thumb }) => ({ key, label, kind, thumb })),
            cutout: s.storedCutout,
          }
        : null;

      // The Original is stored in its own column. When it is also the listing
      // photo, the server copies it from images[0] instead of receiving it twice.
      let originalImageUrl: string | null | undefined =
        selectedKey === "ORIGINAL" ? undefined : byKey("ORIGINAL")?.dataUrl ?? photo;
      let enhancedImageUrl: string | null | undefined =
        selectedKey === "ENHANCED" ? undefined : byKey("ENHANCED")?.dataUrl ?? null;

      const size = () =>
        [listingImage, ...otherImages, originalImageUrl ?? "", enhancedImageUrl ?? ""].reduce(
          (n, v) => n + (v?.length ?? 0),
          0
        ) + (imageVariants ? JSON.stringify(imageVariants).length : 0);
      if (size() > CLIENT_BODY_BUDGET && imageVariants) imageVariants = { ...imageVariants, cutout: null };
      if (size() > CLIENT_BODY_BUDGET) imageVariants = null;
      if (size() > CLIENT_BODY_BUDGET) enhancedImageUrl = null;
      if (size() > CLIENT_BODY_BUDGET && originalImageUrl) {
        // Last resort: list the camera frame itself so provenance still holds.
        originalImageUrl = undefined;
        return {
          listingImage: byKey("ORIGINAL")?.dataUrl ?? photo,
          fields: {
            selectedImageVariant: "ORIGINAL",
            photoQualityScore: verdict?.source === "AI" ? verdict.score : null,
            photoQualityNotes: notes.join(" ").slice(0, 500) || null,
            photoQualitySource: source,
            photoRetakeCount: inputs.current.retakeCount,
            backgroundRemovalMode: s.mode,
          },
        };
      }

      return {
        listingImage,
        fields: {
          ...(originalImageUrl !== undefined ? { originalImageUrl } : {}),
          ...(enhancedImageUrl !== undefined ? { enhancedImageUrl } : {}),
          selectedImageVariant: selectedKey,
          imageVariants,
          photoQualityScore: verdict?.source === "AI" ? verdict.score : null,
          photoQualityNotes: notes.join(" ").slice(0, 500) || null,
          photoQualitySource: source,
          photoRetakeCount: inputs.current.retakeCount,
          backgroundRemovalMode: s.mode,
        },
      };
    },
    [enabled, photo, state]
  );

  return { state, acceptPhoto, select, collect };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

interface PhotoStudioProps {
  state: StudioState;
  t: (key: string) => string;
  onRetake: () => void;
  onUseAnyway: () => void;
  onSelect: (key: string) => void;
}

const BUILD_STEP_KEY: Record<NonNullable<StudioState["buildStep"]>, string> = {
  enhancing: "photo_enhancing",
  removing_background: "photo_removing_background",
  composing: "photo_composing",
};

const MODE_KEY: Record<BackgroundRemovalMode, string> = {
  ON_DEVICE: "photo_bg_on_device",
  SERVER: "photo_bg_server",
  NONE: "photo_bg_none",
};

export interface LookOption {
  key: string;
  /** i18n key. */
  label: string;
  kind: PhotoVariant["kind"];
  thumb: string;
}

interface LookGalleryProps {
  options: LookOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
  t: (key: string) => string;
  /** id of the visible heading that names the group. */
  labelledBy: string;
  /** A trailing placeholder tile while more looks are still rendering. */
  pending?: boolean;
  disabled?: boolean;
}

/**
 * The look picker, shared by capture step 2 and the listing card on
 * /artisan/market so the two can never behave differently.
 *
 * A real radiogroup: one tab stop (roving tabIndex on the checked option),
 * arrow keys and Home/End move AND select, as the WAI-ARIA radio pattern
 * specifies. It scrolls sideways inside its own container, so a 360 px screen
 * never gets a horizontal body scroll.
 */
export function LookGallery({ options, selectedKey, onSelect, t, labelledBy, pending, disabled }: LookGalleryProps) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || options.length === 0) return;
    const index = Math.max(0, options.findIndex((o) => o.key === selectedKey));
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(options[next].key);
    optionRefs.current[next]?.focus();
  };

  const hasChecked = options.some((o) => o.key === selectedKey);

  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="flex gap-3 px-1 pt-1"
      >
        {options.map((option, index) => {
          const selected = option.key === selectedKey;
          const look = t(option.label);
          const badge =
            option.kind === "GENERATED" ? t("photo_badge_generated") : option.kind === "PRESET" ? t("photo_badge_cutout") : "";
          return (
            <button
              key={option.key}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (!hasChecked && index === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(option.key)}
              className={cn(
                "w-24 shrink-0 rounded-xl border bg-white p-1 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-maroon)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
                selected ? "border-transparent ring-2 ring-[var(--color-maroon)] shadow-card" : "border-gray-200 hover:border-gray-300"
              )}
            >
              <span className="relative block aspect-square overflow-hidden rounded-lg bg-[var(--color-pill)]">
                <Image
                  src={option.thumb}
                  alt={t("photo_variant_alt").replace("{look}", look)}
                  fill
                  sizes="96px"
                  unoptimized
                  className="object-cover"
                />
                {selected && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-maroon)] text-white">
                    <Check size={12} aria-hidden="true" />
                  </span>
                )}
              </span>
              <span className="mt-1 block truncate text-[11px] font-bold text-gray-800">{look}</span>
              <span className="flex min-h-4 items-center gap-0.5 text-[10px] text-gray-500">
                {badge && (
                  <>
                    <Sparkles size={10} aria-hidden="true" />
                    {badge}
                  </>
                )}
              </span>
            </button>
          );
        })}
        {pending && (
          <span aria-hidden="true" className="w-24 shrink-0 p-1">
            <span className="block aspect-square animate-pulse rounded-lg bg-[var(--color-pill)]" />
          </span>
        )}
      </div>
    </div>
  );
}

export function PhotoStudio({ state, t, onRetake, onUseAnyway, onSelect }: PhotoStudioProps) {
  const uid = useId();
  const retakeTitleId = `${uid}-retake`;
  const lookTitleId = `${uid}-look`;
  const { phase, verdict, variants, selectedKey } = state;
  if (phase === "idle") return null;

  return (
    <div className="mb-6 space-y-4">
      {/* 1. Checking — a compact line, not a full-screen spinner. */}
      {phase === "checking" && (
        <div role="status" aria-live="polite" className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-card">
          <p className="flex items-center gap-2 font-bold text-gray-800">
            <Loader2 size={16} className="shrink-0 animate-spin text-[var(--color-maroon)]" aria-hidden="true" />
            {t("photo_checking")}
          </p>
          {state.localHint && <p className="mt-1 text-xs leading-relaxed text-gray-600">{t(state.localHint)}</p>}
        </div>
      )}

      {/* 2. Retake — guidance, not rejection: role=status with a heading. */}
      {phase === "retake" && verdict && (
        <section
          role="status"
          aria-labelledby={retakeTitleId}
          className="rounded-2xl border border-gray-200 bg-[var(--color-pill)] px-4 py-4 shadow-card"
        >
          <h4 id={retakeTitleId} className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Camera size={18} className="shrink-0 text-[var(--color-maroon)]" aria-hidden="true" />
            {t("photo_retake_title")}
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">{t(verdict.reasonKey || "photo_retake_unclear")}</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onRetake}
              className="min-h-11 flex-1 rounded-xl bg-[var(--color-maroon)] px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-maroon)] focus-visible:ring-offset-2"
            >
              {t("photo_retake_action")}
            </button>
            <button
              type="button"
              onClick={onUseAnyway}
              className="min-h-11 flex-1 rounded-xl border-2 border-[var(--color-maroon)] bg-white px-4 py-2.5 text-sm font-bold text-[var(--color-maroon)] transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-maroon)] focus-visible:ring-offset-2"
            >
              {t("photo_use_anyway")}
            </button>
          </div>
        </section>
      )}

      {(phase === "building" || phase === "ready") && (
        <>
          {/* SOFT advice sits above the gallery; the flow has already continued. */}
          {verdict?.advice === "SOFT" && verdict.reasonKey && (
            <p className="flex gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-relaxed text-gray-700">
              <Info size={16} className="mt-0.5 shrink-0 text-[var(--color-rust)]" aria-hidden="true" />
              <span>
                {t(verdict.reasonKey)}
                {state.usedAnyway && <> {t("photo_used_anyway_note")}</>}
              </span>
            </p>
          )}

          <section aria-labelledby={lookTitleId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 id={lookTitleId} className="text-sm font-bold text-gray-900">
                {t("photo_choose_look")}
              </h4>
              <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-[11px] text-gray-500">
                {state.buildStep ? (
                  <>
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                    {t(BUILD_STEP_KEY[state.buildStep])}
                  </>
                ) : state.cutoutRejected ? (
                  t("photo_bg_rejected")
                ) : state.mode ? (
                  t(MODE_KEY[state.mode])
                ) : null}
              </p>
            </div>
            <p className="mb-3 mt-0.5 text-[11px] text-gray-500">{t("photo_choose_look_help")}</p>

            <LookGallery
              options={variants}
              selectedKey={selectedKey}
              onSelect={onSelect}
              t={t}
              labelledBy={lookTitleId}
              pending={phase === "building"}
            />

            <p className="mt-2 text-[11px] leading-relaxed text-gray-600">{t("photo_untouched_note")}</p>
            {verdict?.recommendedBg && (
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                <span className="font-bold">{t("photo_why_suggest")}</span> {verdict.recommendedBg}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
