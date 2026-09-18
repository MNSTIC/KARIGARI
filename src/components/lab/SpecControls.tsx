"use client";

import { useId, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { PillTabs, SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import {
  BORDERS,
  GRID_MAX,
  GRID_MIN,
  HEX,
  MOTIFS,
  PALETTE_MAX,
  PALETTE_MIN,
  REPEATS,
  ROTATION_MAX,
  SCALE_MAX,
  SCALE_MIN,
  STROKE_MAX,
  STROKE_MIN,
  normaliseColour,
  type Border,
  type Motif,
  type MotifSpec,
  type Repeat,
} from "@/lib/motifSpec";
import { PALETTES, paletteColours } from "@/lib/motifPalettes";

/**
 * The controls beside the preview: real geometry, not filters.
 *
 * Every control is bounded by the same constants `validateSpec()` clamps to, so
 * a slider cannot ask the renderer for something it would refuse to draw, and
 * the artisan never has a value silently taken away from them.
 */

const MOTIF_KEY = (motif: Motif) => `motif_${motif.replace(/-/g, "_")}`;
const REPEAT_KEY = (repeat: Repeat) => `repeat_${repeat.replace(/-/g, "_")}`;
const BORDER_KEY: Record<Border, string> = {
  none: "lab_border_none",
  temple: "lab_border_temple",
  stripe: "lab_border_stripe",
  zigzag: "lab_border_zigzag",
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format: (value: number) => string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-gray-800">
          {label}
        </label>
        <span className="text-[12px] tabular-nums text-gray-500">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-11 w-full accent-[var(--color-maroon)]"
      />
    </div>
  );
}

function SwatchEditor({
  palette,
  onChange,
}: {
  palette: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const panelId = useId();

  const set = (index: number, colour: string) => {
    const next = [...palette];
    next[index] = colour;
    onChange(next);
    setOpen(null);
    setCustom("");
  };

  const remove = (index: number) => {
    if (palette.length <= PALETTE_MIN) return;
    onChange(palette.filter((_, i) => i !== index));
    setOpen(null);
  };

  const add = () => {
    if (palette.length >= PALETTE_MAX) return;
    const pool = paletteColours().filter((colour) => !palette.includes(colour));
    onChange([...palette, pool[0] ?? "#2b2b2b"]);
  };

  return (
    <div>
      <SectionEyebrow>{t("lab_palette")}</SectionEyebrow>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {palette.map((colour, index) => (
          <button
            key={`${colour}-${index}`}
            type="button"
            onClick={() => setOpen(open === index ? null : index)}
            aria-expanded={open === index}
            aria-controls={panelId}
            aria-label={`${t("lab_palette")} ${index + 1}: ${colour}`}
            className={cn(
              "h-11 w-11 rounded-xl border-2 transition",
              open === index ? "border-gray-900" : "border-gray-200"
            )}
            style={{ backgroundColor: colour }}
          />
        ))}
        {palette.length < PALETTE_MAX && (
          <button
            type="button"
            onClick={add}
            aria-label={t("lab_palette_add")}
            className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-gray-500 hover:border-gray-400"
          >
            <Plus size={16} aria-hidden />
          </button>
        )}
      </div>

      {open !== null && (
        <div id={panelId} className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-[12px] font-semibold text-gray-700">{t("lab_palette_pick")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {paletteColours().map((colour) => (
              <button
                key={colour}
                type="button"
                onClick={() => set(open, colour)}
                aria-label={colour}
                className="h-10 w-10 rounded-lg border border-gray-200"
                style={{ backgroundColor: colour }}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="#1f3a68"
              aria-label={t("lab_palette_hex")}
              className="min-h-[40px] w-32 rounded-lg border border-gray-300 bg-card px-2.5 text-[13px] tabular-nums"
            />
            <button
              type="button"
              disabled={!normaliseColour(custom)}
              onClick={() => {
                const colour = normaliseColour(custom);
                if (colour) set(open, colour);
              }}
              className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              <Check size={14} aria-hidden /> {t("lab_palette_use")}
            </button>
            {palette.length > PALETTE_MIN && (
              <button
                type="button"
                onClick={() => remove(open)}
                className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-gray-600 underline underline-offset-2"
              >
                <X size={14} aria-hidden /> {t("lab_palette_remove")}
              </button>
            )}
          </div>
          {custom && !HEX.test(custom.trim()) && !normaliseColour(custom) && (
            <p className="mt-2 text-[12px] text-[var(--color-rust)]">{t("lab_palette_bad_hex")}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PALETTES.map((committed) => (
          <button
            key={committed.key}
            type="button"
            onClick={() => onChange([...committed.colours])}
            className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-gray-200 bg-card px-3 text-[12px] font-medium text-gray-700 hover:border-gray-300"
          >
            <span className="flex overflow-hidden rounded-full">
              {committed.colours.map((colour) => (
                <span key={colour} className="h-3 w-3" style={{ backgroundColor: colour }} />
              ))}
            </span>
            {t(committed.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SpecControls({
  spec,
  onChange,
}: {
  spec: MotifSpec;
  onChange: (next: MotifSpec) => void;
}) {
  const { t } = useLanguage();
  const patch = (fields: Partial<MotifSpec>) => onChange({ ...spec, ...fields });

  return (
    <div className="space-y-5">
      <div>
        <SectionEyebrow>{t("lab_motif")}</SectionEyebrow>
        <PillTabs
          ariaLabel={t("lab_motif")}
          value={spec.motif}
          onChange={(motif) => patch({ motif })}
          className="mt-2"
          options={MOTIFS.map((motif) => ({ value: motif, label: t(MOTIF_KEY(motif)) }))}
        />
      </div>

      <div>
        <SectionEyebrow>{t("lab_repeat")}</SectionEyebrow>
        <SegmentedToggle
          ariaLabel={t("lab_repeat")}
          value={spec.repeat}
          onChange={(repeat) => patch({ repeat })}
          className="mt-2"
          options={REPEATS.map((repeat) => ({ value: repeat, label: t(REPEAT_KEY(repeat)) }))}
        />
      </div>

      <div className="space-y-4">
        <Slider
          label={t("lab_grid")}
          value={spec.grid}
          min={GRID_MIN}
          max={GRID_MAX}
          step={1}
          onChange={(grid) => patch({ grid })}
          format={(value) => `${value} × ${value}`}
        />
        <Slider
          label={t("lab_scale")}
          value={spec.scale}
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={0.05}
          onChange={(scale) => patch({ scale })}
          format={(value) => `${Math.round(value * 100)}%`}
        />
        <Slider
          label={t("lab_rotation")}
          value={spec.rotation}
          min={0}
          max={ROTATION_MAX}
          step={1}
          onChange={(rotation) => patch({ rotation })}
          format={(value) => `${value}°`}
        />
        <Slider
          label={t("lab_stroke")}
          value={spec.strokeWidth}
          min={STROKE_MIN}
          max={STROKE_MAX}
          step={0.5}
          onChange={(strokeWidth) => patch({ strokeWidth })}
          format={(value) => `${value} px`}
        />
      </div>

      <SwatchEditor palette={spec.palette} onChange={(palette) => patch({ palette })} />

      <div>
        <SectionEyebrow>{t("lab_border")}</SectionEyebrow>
        <SegmentedToggle
          ariaLabel={t("lab_border")}
          value={spec.border}
          onChange={(border) => patch({ border })}
          className="mt-2"
          options={BORDERS.map((border) => ({ value: border, label: t(BORDER_KEY[border]) }))}
        />
      </div>
    </div>
  );
}
