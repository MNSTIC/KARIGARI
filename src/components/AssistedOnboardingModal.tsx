"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  X,
  Mic,
  MicOff,
  Sparkles,
  Camera,
  Trash2,
  CheckCircle2,
  Loader2,
  UserRound,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRupees } from "@/lib/pricing";

export interface OnboardingArtisan {
  id: string;
  name: string;
  craftType: string | null;
  clusterName: string | null;
  location: string | null;
  mobileNumber: string | null;
}

interface CreatedItemResponse {
  item?: { id: string };
  valuations?: {
    fairWageFloor?: number;
    marketPriceMin?: number;
    marketPriceMax?: number;
    standardMarketPrice?: number;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  artisans: OnboardingArtisan[];
  defaultArtisanId?: string;
  onCreated?: () => void;
}

const LANGUAGES = [
  { label: "Odia", speech: "or-IN" },
  { label: "Hindi", speech: "hi-IN" },
  { label: "Telugu", speech: "te-IN" },
  { label: "English", speech: "en-IN" },
];

/* Minimal shape of the Web Speech API we actually use. It is not in lib.dom. */
type SpeechAlternatives = ArrayLike<{ transcript: string }> & { isFinal: boolean };
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechAlternatives>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Assisted Onboarding (new_admin.md Tier 1.3).
 *
 * The facilitator holds the device for an artisan who has no smartphone: the
 * artisan speaks in their own language, the AI translates and values the piece,
 * and the listing is published under the artisan's own profile.
 */
export function AssistedOnboardingModal({
  isOpen,
  onClose,
  artisans,
  defaultArtisanId,
  onCreated,
}: Props) {
  const [artisanOverride, setArtisanOverride] = useState<string | null>(null);
  const [language, setLanguage] = useState("Odia");
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdItem, setCreatedItem] = useState<CreatedItemResponse | null>(null);

  const [craftType, setCraftType] = useState("");
  const [englishDescription, setEnglishDescription] = useState("");
  const [laborDays, setLaborDays] = useState("");
  const [rawMaterialCost, setRawMaterialCost] = useState("");
  const [image, setImage] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Selection is derived, not synced — the override only exists once the
  // facilitator picks someone other than the row they opened the modal from.
  const artisanId = artisanOverride ?? defaultArtisanId ?? artisans[0]?.id ?? "";

  // Stop any live microphone stream when the modal closes.
  useEffect(() => {
    if (!isOpen && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
      setIsListening(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedArtisan = artisans.find((a) => a.id === artisanId);

  const resetAll = () => {
    setTranscript("");
    setCraftType("");
    setEnglishDescription("");
    setLaborDays("");
    setRawMaterialCost("");
    setImage(null);
    setError("");
    setCreatedItem(null);
    setArtisanOverride(null);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const toggleListening = () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = LANGUAGES.find((l) => l.label === language)?.speech || "hi-IN";
    recognition.interimResults = true;
    recognition.continuous = true;

    let finalText = transcript;
    recognition.onresult = (event: SpeechResultEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk + " ";
        else interim += chunk;
      }
      setTranscript((finalText + interim).trimStart());
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  };

  const handleParse = async () => {
    if (!transcript.trim()) {
      setError("Record or type what the artisan said first.");
      return;
    }
    setError("");
    setIsParsing(true);
    try {
      const res = await fetch("/api/items/voice-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionalTranscript: transcript }),
      });
      const result = await res.json();
      if (result?.data) {
        setCraftType(result.data.craftType || "");
        setEnglishDescription(result.data.englishDescription || "");
        if (result.data.laborDays) setLaborDays(String(result.data.laborDays));
        if (result.data.rawMaterialCost) setRawMaterialCost(String(result.data.rawMaterialCost));
        if (result.data.sourceLanguage && result.data.sourceLanguage !== "Unknown") {
          setLanguage(result.data.sourceLanguage);
        }
      } else {
        setError("AI could not read that. Fill the fields in by hand below.");
      }
    } catch {
      setError("AI service unreachable. Fill the fields in by hand below.");
    } finally {
      setIsParsing(false);
    }
  };

  // Downscale before base64-encoding so an assisted upload from a field phone
  // does not push a multi-megabyte payload through the API.
  const handlePhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const max = 800;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setImage(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    setError("");
    if (!artisanId) return setError("Choose the artisan this piece belongs to.");
    if (!craftType.trim()) return setError("Craft type is required.");
    if (!laborDays || Number(laborDays) <= 0) return setError("Labour days must be greater than zero.");
    if (rawMaterialCost === "" || Number(rawMaterialCost) < 0)
      return setError("Raw material cost is required.");

    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/capture-on-behalf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artisanId,
          craftType: craftType.trim(),
          laborDays: Number(laborDays),
          rawMaterialCost: Number(rawMaterialCost),
          descriptionOriginal: transcript.trim() || null,
          descriptionEnglish: englishDescription.trim() || null,
          aiGeneratedListing: englishDescription.trim() || null,
          tags: [craftType.trim()],
          images: image ? [image] : [],
          catalogMethod: transcript.trim() ? "VOICE" : "MANUAL",
          voiceLanguage: language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to publish the listing.");
      setCreatedItem(data);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish the listing.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-4 z-10">
          <div>
            <h3 className="text-xl font-serif font-bold text-gray-900">
              Add Product on Behalf of Artisan
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              For artisans without a smartphone. You hold the device, they speak in their language.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-900 transition-colors shrink-0 p-1"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {createdItem ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h4 className="text-xl font-serif font-bold text-gray-900 mb-2">Listing created</h4>
            <p className="text-sm text-gray-500 mb-6">
              Published under {selectedArtisan?.name}. It is now waiting in the Voice QA queue for
              your review.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 text-left">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  AI Fair Wage Floor
                </p>
                <p className="font-bold text-gray-900">
                  {formatRupees(createdItem.valuations?.fairWageFloor)}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Market Range
                </p>
                <p className="font-bold text-gray-900">
                  {formatRupees(createdItem.valuations?.marketPriceMin)} –{" "}
                  {formatRupees(createdItem.valuations?.marketPriceMax)}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Captured In
                </p>
                <p className="font-bold text-gray-900">{language}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={resetAll}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-colors"
              >
                Add another
              </button>
              <button
                onClick={handleClose}
                className="flex-1 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 text-red-700 border border-red-100 px-4 py-3 rounded-xl text-sm font-medium">
                {error}
              </div>
            )}

            {/* Step 1 - who */}
            <section>
              <SectionLabel step={1} title="Which artisan is this for?" icon={<UserRound size={14} />} />
              <select
                value={artisanId}
                onChange={(e) => setArtisanOverride(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
              >
                {artisans.length === 0 && <option value="">No artisans in your cluster</option>}
                {artisans.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.craftType || "Craft"} · {a.clusterName || a.location || "Cluster"}
                  </option>
                ))}
              </select>
            </section>

            {/* Step 2 - voice */}
            <section>
              <SectionLabel
                step={2}
                title="Record what the artisan says"
                icon={<Languages size={14} />}
              />
              <div className="flex flex-wrap gap-2 mb-3">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.label}
                    type="button"
                    onClick={() => setLanguage(l.label)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                      language === l.label
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={!speechSupported}
                  className={cn(
                    "flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all shrink-0",
                    isListening
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "bg-primary text-white hover:bg-primary-dark",
                    !speechSupported && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                  {isListening ? "Stop recording" : "Hand over & record"}
                </button>
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={isParsing || !transcript.trim()}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-gray-900 text-white hover:bg-black transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {isParsing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {isParsing ? "Translating…" : "Translate & value with AI"}
                </button>
              </div>

              {!speechSupported && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
                  This browser has no speech recognition. Type the artisan&apos;s words below
                  instead — everything else still works.
                </p>
              )}

              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={3}
                placeholder={`What the artisan said, in ${language}…`}
                className="mt-3 w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
              />
            </section>

            {/* Step 3 - review */}
            <section>
              <SectionLabel step={3} title="Confirm the details" icon={<Sparkles size={14} />} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Craft type" value={craftType} onChange={setCraftType} placeholder="e.g. Sambalpuri Bandha Saree" />
                <Field
                  label="Labour days"
                  value={laborDays}
                  onChange={setLaborDays}
                  placeholder="e.g. 15"
                  type="number"
                />
                <Field
                  label="Raw material cost (₹)"
                  value={rawMaterialCost}
                  onChange={setRawMaterialCost}
                  placeholder="e.g. 2000"
                  type="number"
                />
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                    Photo (optional)
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePhoto(f);
                    }}
                  />
                  {image ? (
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-200 shrink-0">
                        <Image src={image} alt="Craft" fill className="object-cover" unoptimized />
                      </div>
                      <button
                        type="button"
                        onClick={() => setImage(null)}
                        className="flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-700"
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-500 hover:border-primary hover:text-primary transition-all"
                    >
                      <Camera size={16} /> Take or upload a photo
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  English listing (AI generated, editable)
                </label>
                <textarea
                  value={englishDescription}
                  onChange={(e) => setEnglishDescription(e.target.value)}
                  rows={3}
                  placeholder="Runs the AI translation, or write it yourself."
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
                />
              </div>
            </section>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleClose}
                className="sm:flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSaving || artisans.length === 0}
                className="sm:flex-[2] py-3 px-4 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSaving && <Loader2 size={16} className="animate-spin" />}
                {isSaving ? "Publishing…" : "Publish under artisan's profile"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ step, title, icon }: { step: number; title: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
        {step}
      </span>
      <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
        {icon}
        {title}
      </h4>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all"
      />
    </div>
  );
}
