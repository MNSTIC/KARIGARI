"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Mic, Palette, Save, Sparkles, Square, Trash2, Wand2 } from "lucide-react";
import { Shell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useLanguage } from "@/lib/translations";
import { useSpeechCapture, type SpeechCaptureError } from "@/lib/useSpeechCapture";
import { fill } from "@/components/buyer/passportFormat";
import { cn } from "@/lib/utils";
import { MotifPreview } from "@/components/lab/MotifPreview";
import { SpecControls } from "@/components/lab/SpecControls";
import { defaultSpec, renderMotifSvg, validateSpec, type MotifSpec } from "@/lib/motifSpec";
import { notesAreUsable, type LabNotes } from "@/lib/designLab";

/**
 * Design Lab — try a pattern before you cut cloth.
 *
 * The model produces a *grammar* (which motif, which repeat, how dense, which
 * colours) and our own pure renderer draws it, so what the artisan manipulates
 * is real geometry rather than a picture somebody's model imagined. Every
 * control is bounded by the same constants the validator clamps to.
 *
 * Two things this page will not do:
 *   - It never calls a concept a photograph. A sketch cannot become
 *     `CraftItem.images[0]`, and "Start a listing" carries WORDS only.
 *   - It never claims a pattern is a community's traditional motif. The
 *     disclaimer under the preview says so in the artisan's own language.
 *
 * With no AI key the page works unchanged, seeded deterministically from the
 * artisan's own words and labelled "made without AI".
 */

const SPEECH_ERROR_KEY: Record<SpeechCaptureError, string> = {
  mic_denied: "log_sale_voice_error_denied",
  no_speech: "log_sale_voice_error_nospeech",
  no_mic: "log_sale_voice_error_nomic",
  unsupported: "log_sale_voice_error_unsupported",
  failed: "log_sale_voice_error_failed",
};

interface Concept {
  id: string;
  prompt: string;
  title: string;
  spec: MotifSpec;
  source: "AI" | "FALLBACK";
  svgThumb: string | null;
  usedForItemId: string | null;
  createdAt: string;
}

const IST_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
};

export default function DesignLabPage() {
  const { t, language } = useLanguage();
  const router = useRouter();

  const [prompt, setPrompt] = useState("");
  const [spec, setSpec] = useState<MotifSpec | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState<LabNotes | null>(null);
  const [source, setSource] = useState<"AI" | "FALLBACK">("FALLBACK");
  const [thin, setThin] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  // ---- saved concepts ----------------------------------------------------
  const loadConcepts = useCallback(async (nextPage: number) => {
    try {
      const res = await fetch(`/api/artisan/design-lab?page=${nextPage}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) return;
      setConcepts((prev) => (nextPage === 0 ? data.concepts : [...prev, ...data.concepts]));
      setTotal(data.total ?? 0);
      setHasMore(Boolean(data.hasMore));
      setPage(nextPage);
    } catch (loadError) {
      console.warn("[design-lab] list unavailable:", (loadError as Error)?.message);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same pattern the schemes page uses.
    const kickoff = setTimeout(() => void loadConcepts(0), 0);
    return () => clearTimeout(kickoff);
  }, [loadConcepts]);

  // ---- compose -----------------------------------------------------------
  const compose = useCallback(
    async (text: string) => {
      setComposing(true);
      setError(null);
      setSavedId(null);
      try {
        const res = await fetch("/api/artisan/design-lab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, language }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        setSpec(validateSpec(data.spec));
        setTitle(data.title || "");
        setNotes(data.notes ?? null);
        setSource(data.source === "AI" ? "AI" : "FALLBACK");
        setThin(Boolean(data.thin));
      } catch (composeError) {
        console.warn("[design-lab] compose failed:", (composeError as Error)?.message);
        // The composer is deterministic and runs in the browser too, so a dead
        // network still leaves the artisan with cloth to work on.
        setSpec(defaultSpec("cotton-yarn", text));
        setSource("FALLBACK");
        setNotes(null);
        setError(t("lab_offline_fallback"));
      } finally {
        setComposing(false);
      }
    },
    [language, t]
  );

  /** A recorded clip, for Odia and for browsers with no recognizer. */
  const onAudio = useCallback(
    async (audio: Blob, mimeType: string) => {
      setComposing(true);
      setVoiceError(null);
      try {
        const body = new FormData();
        body.append("file", audio, mimeType.includes("mp4") ? "design.mp4" : "design.webm");
        body.append("language", language);
        const res = await fetch("/api/artisan/design-lab", { method: "POST", body });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        if (data.prompt) setPrompt(data.prompt);
        setSpec(validateSpec(data.spec));
        setTitle(data.title || "");
        setNotes(data.notes ?? null);
        setSource(data.source === "AI" ? "AI" : "FALLBACK");
        setThin(Boolean(data.thin));
      } catch {
        setVoiceError(t("log_sale_voice_error_failed"));
      } finally {
        setComposing(false);
      }
    },
    [language, t]
  );

  const onTranscript = useCallback((text: string) => {
    setPrompt((prev) => (prev ? `${prev} ${text}` : text));
  }, []);

  const speech = useSpeechCapture({ language, onTranscript, onAudio });
  const speechError = speech.error ? t(SPEECH_ERROR_KEY[speech.error]) : voiceError;

  // ---- save / download / hand off ---------------------------------------
  const save = async () => {
    if (!spec) return;
    setSaving(true);
    try {
      const res = await fetch("/api/artisan/design-lab", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(savedId ? { id: savedId } : {}),
          spec,
          title: title || t("lab_untitled"),
          prompt,
          language,
          source,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setSavedId(data.concept.id);
      await loadConcepts(0);
    } catch (saveError) {
      setError((saveError as Error)?.message || t("network_error_retry"));
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!spec) return;
    // Our own renderer's string, wrapped in a blob — no library, no server hop.
    const blob = new Blob([renderMotifSvg(spec, 1024)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = downloadRef.current;
    if (!anchor) return;
    anchor.href = url;
    anchor.download = `${(title || "karigari-pattern").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.svg`;
    anchor.click();
    // Revoked on the next tick: the click has already started the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /**
   * Hand the concept to the capture flow.
   *
   * It carries an id, and the capture flow reads the concept's WORDS from it.
   * The drawing is deliberately left behind: a listing's photographs are of the
   * real piece or there are none.
   */
  const startListing = async () => {
    let id = savedId;
    if (!id) {
      await save();
      id = savedId;
    }
    if (!id) return;
    router.push(`/artisan/dashboard?concept=${encodeURIComponent(id)}`);
  };

  const removeConcept = async (id: string) => {
    try {
      const res = await fetch(`/api/artisan/design-lab?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return;
      if (savedId === id) setSavedId(null);
      await loadConcepts(0);
    } catch (deleteError) {
      console.warn("[design-lab] delete failed:", (deleteError as Error)?.message);
    }
  };

  const openConcept = (concept: Concept) => {
    setSpec(validateSpec(concept.spec));
    setTitle(concept.title);
    setPrompt(concept.prompt);
    setSource(concept.source);
    setNotes(null);
    setSavedId(concept.id);
    setThin(false);
  };

  return (
    <Shell>
      <div className="mb-9">
        <PageTitle>{t("lab_title")}</PageTitle>
        <PageLede>{t("lab_lede")}</PageLede>
      </div>

      {/* ------------------------------------------------------- describe */}
      <Card as="section" pad="lg" radius="3xl" className="kg-enter" aria-label={t("lab_describe")}>
        <SectionEyebrow>{t("lab_describe")}</SectionEyebrow>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("lab_describe")}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              maxLength={400}
              placeholder={t("lab_placeholder")}
              className="w-full rounded-2xl border border-gray-300 bg-card p-3 text-[15px] leading-relaxed"
            />
          </label>
          <div className="flex shrink-0 gap-2">
            {speech.supported && (
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                aria-label={t("lab_speak")}
                aria-pressed={speech.listening}
                className={cn(
                  "kg-press inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border transition",
                  speech.listening
                    ? "border-[var(--color-rust)] bg-[var(--color-rust)] text-white"
                    : "border-gray-300 bg-card text-gray-700"
                )}
              >
                {speech.listening ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
              </button>
            )}
            <button
              type="button"
              onClick={() => void compose(prompt)}
              disabled={composing}
              className="kg-press inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-primary px-4 text-[14px] font-semibold text-white disabled:opacity-60"
            >
              {composing ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wand2 size={16} aria-hidden />}
              {t("lab_generate")}
            </button>
          </div>
        </div>

        {speech.listening && speech.interim && (
          <p className="mt-2 text-[13px] italic text-gray-500" role="status">
            {speech.interim}
          </p>
        )}
        {speechError && <p className="mt-2 text-[13px] text-[var(--color-rust)]">{speechError}</p>}
        {error && <p className="mt-2 text-[13px] text-[var(--color-rust)]">{error}</p>}
      </Card>

      {/* -------------------------------------------------------- compose */}
      {spec && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card as="section" pad="lg" radius="3xl" className="min-w-0" aria-label={t("lab_preview")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder={t("lab_untitled")}
                  aria-label={t("lab_concept_title")}
                  className="kg-display min-h-[44px] w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1 text-[24px] leading-tight text-gray-900 hover:border-gray-200 focus:border-gray-300"
                />
              </div>
              <Badge variant={source === "AI" ? "info" : "neutral"}>
                {t(source === "AI" ? "lab_source_ai" : "lab_source_fallback")}
              </Badge>
            </div>

            <MotifPreview
              spec={spec}
              size={480}
              className="mt-4 aspect-square w-full"
              label={fill(t("lab_preview_alt"), { motif: t(`motif_${spec.motif.replace(/-/g, "_")}`) })}
            />

            {thin && <p className="mt-3 text-[13px] leading-relaxed text-gray-600">{t("lab_thin_prompt")}</p>}

            <p className="mt-3 text-[12px] leading-relaxed text-gray-500">{t("lab_concept_disclaimer")}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-white disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
                {t(savedId ? "lab_saved" : "lab_save")}
              </button>
              <button
                type="button"
                onClick={download}
                className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-card px-4 text-[14px] font-semibold text-gray-800"
              >
                <Download size={15} aria-hidden /> {t("lab_download")}
              </button>
              <button
                type="button"
                onClick={() => void startListing()}
                className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-card px-4 text-[14px] font-semibold text-gray-800"
              >
                <Sparkles size={15} aria-hidden /> {t("lab_start_listing")}
              </button>
              {/* Anchor rather than a synthetic download, so the browser's own
                  save dialog is what the artisan sees. */}
              <a ref={downloadRef} className="hidden" aria-hidden />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t("lab_listing_words_only")}</p>
          </Card>

          <div className="space-y-6">
            <Card as="section" pad="lg" radius="3xl" aria-label={t("lab_controls")}>
              <SpecControls spec={spec} onChange={(next) => setSpec(validateSpec(next))} />
            </Card>

            {notes && notesAreUsable(notes) && (
              <Card as="section" pad="lg" radius="3xl" tone="muted" aria-label={t("lab_notes")}>
                <div className="flex items-center gap-2">
                  <SectionEyebrow>{t("lab_notes")}</SectionEyebrow>
                  <Badge variant="info">{t("lab_ai_suggestion")}</Badge>
                </div>
                {notes.motifNotes && (
                  <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{notes.motifNotes}</p>
                )}
                {notes.paletteNames.length > 0 && (
                  <p className="mt-2 text-[13px] text-gray-600">
                    <span className="font-semibold">{t("lab_palette")}:</span> {notes.paletteNames.join(", ")}
                  </p>
                )}
                {notes.materialNote && (
                  <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
                    <span className="font-semibold">{t("lab_material_note")}:</span> {notes.materialNote}
                  </p>
                )}
                {notes.laborDaysEstimate !== null && (
                  <p className="mt-2 text-[13px] text-gray-600">
                    <span className="font-semibold">{t("lab_labor_estimate")}:</span>{" "}
                    {fill(t("lab_labor_days"), { days: notes.laborDaysEstimate })}
                  </p>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------------- saved concepts */}
      <section className="mt-9" aria-label={t("lab_my_concepts")}>
        <SectionEyebrow>{t("lab_my_concepts")}</SectionEyebrow>
        {concepts.length === 0 ? (
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t("lab_empty")}</p>
        ) : (
          <>
            <ul className="kg-rail -mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-2">
              {concepts.map((concept) => (
                <li key={concept.id} className="w-[168px] shrink-0">
                  <Card pad="sm" className="h-full">
                    <button
                      type="button"
                      onClick={() => openConcept(concept)}
                      className="block w-full text-left"
                      aria-label={concept.title}
                    >
                      <MotifPreview
                        spec={concept.spec}
                        size={240}
                        className="aspect-square w-full"
                        label={concept.title}
                      />
                      <span className="mt-2 block truncate text-[13px] font-semibold text-gray-900">
                        {concept.title}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {new Date(concept.createdAt).toLocaleString("en-IN", IST_DAY)}
                        {concept.usedForItemId ? ` · ${t("lab_used_for_listing")}` : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeConcept(concept.id)}
                      aria-label={`${t("lab_delete")}: ${concept.title}`}
                      className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-[var(--color-rust)]"
                    >
                      <Trash2 size={13} aria-hidden /> {t("lab_delete")}
                    </button>
                  </Card>
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadConcepts(page + 1)}
                className="kg-press mt-2 inline-flex min-h-[40px] items-center rounded-lg border border-gray-300 bg-card px-3 text-[13px] font-semibold text-gray-800"
              >
                {fill(t("lab_load_more"), { shown: concepts.length, total })}
              </button>
            )}
          </>
        )}
      </section>

      {!spec && (
        <div className="mt-9 flex items-center gap-3 text-gray-400">
          <Palette size={18} aria-hidden />
          <p className="text-[14px]">{t("lab_nothing_yet")}</p>
        </div>
      )}
    </Shell>
  );
}
