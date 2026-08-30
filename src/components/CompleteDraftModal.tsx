"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  IndianRupee,
  Phone,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { estimateCraftValuation, formatRupees } from "@/lib/pricing";

/**
 * Finishes a draft created over the toll-free IVR.
 *
 * The phone call captured the artisan's words but cannot capture a photo or a
 * price, so this modal collects exactly those two things and leaves the spoken
 * transcript visible as the record of what they actually said. The valuation
 * shown is `estimateCraftValuation` — the same function the server re-runs on
 * submit, so the band quoted here is the band that gets stored.
 */

const MAX_IMAGES = 4;

export interface DraftItem {
  id: string;
  craftType: string;
  descriptionOriginal: string | null;
  descriptionEnglish: string | null;
  laborDays: number | null;
  rawMaterialCost: number | null;
  voiceLanguage: string | null;
}

/**
 * Keyed on the draft id so opening a different draft remounts with fresh state,
 * rather than syncing every field across in an effect.
 */
export function CompleteDraftModal({
  item,
  onClose,
  onCompleted,
}: {
  item: DraftItem | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  if (!item) return null;
  return <DraftEditor key={item.id} item={item} onClose={onClose} onCompleted={onCompleted} />;
}

function DraftEditor({
  item,
  onClose,
  onCompleted,
}: {
  item: DraftItem;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { t } = useLanguage();

  // The suggested price is seeded once, from the figures the call captured.
  // Editing the craft type afterwards moves the displayed band but never
  // rewrites a number the artisan has already chosen.
  const initialValuation = useMemo(
    () =>
      estimateCraftValuation(
        item.craftType || "Handmade Craft",
        item.laborDays || 0,
        item.rawMaterialCost || 0
      ),
    [item]
  );

  const [images, setImages] = useState<string[]>([]);
  const [craftType, setCraftType] = useState(item.craftType || "");
  const [descriptionEnglish, setDescriptionEnglish] = useState(item.descriptionEnglish || "");
  const [askingPrice, setAskingPrice] = useState(String(Math.round(initialValuation.standardMarketPrice)));
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const valuation = useMemo(
    () =>
      estimateCraftValuation(
        craftType || item.craftType || "Handmade Craft",
        item.laborDays || 0,
        item.rawMaterialCost || 0
      ),
    [craftType, item]
  );

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCameraActive(false);
  };

  // Never leave the device camera running behind a closed modal.
  useEffect(() => stopCamera, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setIsCameraActive(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (e) {
      console.error("Camera unavailable:", e);
      setError(t("camera_error") || "Camera unavailable.");
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext("2d");
    if (!context) return;
    canvasRef.current.width = videoRef.current.videoWidth || 640;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    context.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
    setImages((prev) => (prev.length < MAX_IMAGES ? [...prev, canvasRef.current!.toDataURL("image/png")] : prev));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
        setImages((prev) => (prev.length < MAX_IMAGES ? [...prev, result] : prev));
      }
    };
    reader.readAsDataURL(file);
  };

  const enteredPrice = Number(askingPrice);
  const hasPrice = askingPrice.trim() !== "" && Number.isFinite(enteredPrice) && enteredPrice > 0;
  const isBelowFairFloor = hasPrice && enteredPrice < valuation.fairWageFloor;

  const submit = async () => {
    if (images.length === 0) return setError(t("draft_needs_photo"));
    if (!hasPrice) return setError(t("draft_needs_price"));

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/items/complete-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          images,
          askingPrice: enteredPrice,
          craftType: craftType.trim() || undefined,
          descriptionEnglish: descriptionEnglish.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || t("draft_submit_failed"));
        return;
      }
      stopCamera();
      onCompleted();
    } catch (e) {
      console.error("Draft submit failed:", e);
      setError(t("draft_submit_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-gray-100 sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-xl font-serif font-bold text-primary">{t("complete_draft_title")}</h2>
            <p className="text-xs text-gray-500 mt-1">{t("complete_draft_intro")}</p>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label={t("close_btn")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* What the artisan actually said, kept verbatim */}
          {item.descriptionOriginal && (
            <div className="bg-[var(--color-mint)]/50 border border-[var(--color-sage)]/40 rounded-xl p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary mb-1.5 flex items-center gap-1.5">
                <Phone size={12} /> {t("voice_transcript")}
                {item.voiceLanguage && item.voiceLanguage !== "Unknown" && (
                  <span className="font-medium normal-case tracking-normal text-primary/60">
                    · {item.voiceLanguage}
                  </span>
                )}
              </p>
              <p className="text-sm text-primary/85 leading-relaxed italic">
                “{item.descriptionOriginal}”
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              {t("craft_type_label")}
            </label>
            <input
              value={craftType}
              onChange={(e) => setCraftType(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-primary focus:outline-none text-sm font-bold text-gray-900 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              {t("listing_description")}
            </label>
            <textarea
              value={descriptionEnglish}
              onChange={(e) => setDescriptionEnglish(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-primary focus:outline-none text-sm text-gray-700 resize-none transition-colors"
            />
          </div>

          {/* Photos — the half the phone call could not capture */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              {t("upload_device")}
            </label>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <button
                onClick={isCameraActive ? stopCamera : startCamera}
                className={cn(
                  "py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2 transition-all text-sm",
                  isCameraActive
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-gray-700 border-gray-200 hover:border-primary"
                )}
              >
                <Camera size={16} /> {t("capture_camera")}
              </button>
              <label className="py-3 rounded-xl font-bold flex items-center justify-center gap-2 border-2 bg-white text-gray-700 border-gray-200 hover:border-primary cursor-pointer transition-all text-sm">
                <UploadCloud size={16} /> {t("upload_device")}
                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>

            {isCameraActive && (
              <div className="relative bg-black rounded-xl overflow-hidden aspect-video mb-3 flex items-end justify-center">
                <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                <button
                  onClick={captureFrame}
                  className="relative z-10 mb-4 bg-white text-primary font-bold px-5 py-2.5 rounded-full shadow-lg"
                >
                  {t("capture_camera")}
                </button>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />

            {images.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {images.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200">
                    {/* Data URLs from the camera/file picker; next/image adds nothing here. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Craft ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"
                      aria-label={t("close_btn")}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Price — same band and same warning as capture step 3 */}
          <div>
            <div className="bg-[var(--color-mint)]/50 border border-[var(--color-sage)]/40 rounded-xl p-4 mb-3 text-xs text-primary/85 leading-relaxed">
              <p className="font-bold text-primary mb-1">
                {formatRupees(valuation.marketPriceMin)} – {formatRupees(valuation.marketPriceMax)}
              </p>
              <p>{t("price_fair_floor_note").replace("{amount}", formatRupees(valuation.fairWageFloor))}</p>
            </div>

            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              {t("asking_price_label")}
            </label>
            <div className="relative mb-2">
              <IndianRupee
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                className={cn(
                  "w-full pl-11 pr-4 py-4 rounded-2xl border-2 bg-white text-lg font-bold text-gray-900 focus:outline-none transition-colors",
                  isBelowFairFloor ? "border-amber-300 focus:border-amber-400" : "border-gray-200 focus:border-primary"
                )}
              />
            </div>
            <p className="text-xs text-gray-400">{t("asking_price_hint")}</p>

            {/* Warns, never blocks: the price stays the artisan's choice. */}
            {isBelowFairFloor && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl mt-3 text-sm flex gap-2 items-start">
                <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                <p>{t("price_below_floor_warning")}</p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 sticky bottom-0 bg-card">
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="flex-1 py-3 rounded-xl font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {submitting ? t("draft_submitting") : t("submit_for_verification")}
          </button>
        </div>
      </div>
    </div>
  );
}
