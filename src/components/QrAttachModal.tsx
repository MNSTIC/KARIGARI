"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "react-qr-code";
import { buildPatchScanUrl, PATCH_QUERY_KEY, SCAN_QUERY_KEY, SCAN_QUERY_VALUE, VERIFY_GATE_PATH } from "@/lib/qrPatch";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  Loader2,
  QrCode,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Attach the physical patch, then prove it.
 *
 * Two steps, in order: download and print the QR for this item's patch id, then
 * photograph the piece with the patch stuck on it. The upload goes to
 * `/api/items/attach-verify`, which decodes the QR and asks the vision model
 * whether the photo shows the same piece as the original capture. Only when
 * both pass does the item become SELLABLE.
 */

interface QrAttachModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: { id: string; patchId: string | null; craftType: string; images?: string[] } | null;
  /** Called after a successful verification so the dashboard can refresh. */
  onVerified: () => void;
}

/** QR size in the printed PNG. Big enough that a phone camera reads it easily. */
const QR_PNG_SIZE = 1024;

export function QrAttachModal({ isOpen, onClose, item, onVerified }: QrAttachModalProps) {
  const { t } = useLanguage();
  const qrWrapRef = useRef<HTMLDivElement>(null);

  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  /**
   * What the decoder actually read, when it read something that was not this
   * piece's patch. Shown beside the expected id so an artisan holding a
   * sticker can compare the two themselves instead of taking our word for it.
   */
  const [scanned, setScanned] = useState<{ got: string | null; expected: string | null } | null>(null);
  const [verified, setVerified] = useState(false);

  // Reset per item so a previous rejection never carries into the next piece.
  useEffect(() => {
    if (!isOpen) return;
    const kickoff = setTimeout(() => {
      setPhoto(null);
      setReason(null);
      setScanned(null);
      setVerified(false);
      setSubmitting(false);
    }, 0);
    return () => clearTimeout(kickoff);
  }, [isOpen, item?.id]);

  if (!isOpen || !item) return null;

  const patchId = item.patchId || "";
  // The QR resolves to the VERIFICATION GATE, not straight to the passport.
  // Whoever scans the physical sticker — Google Lens, a phone camera, any
  // generic reader — lands on /buyer/verify carrying this piece's patch id,
  // and has to show they are holding the object before the provenance,
  // pricing and artisan story open. See src/lib/qrPatch.ts.
  const verifyUrl =
    typeof window !== "undefined"
      ? buildPatchScanUrl(window.location.origin, patchId)
      : `${VERIFY_GATE_PATH}?${PATCH_QUERY_KEY}=${patchId}&${SCAN_QUERY_KEY}=${SCAN_QUERY_VALUE}`;

  /** Rasterise the inline SVG to a PNG the artisan can print. */
  const downloadQr = () => {
    const svg = qrWrapRef.current?.querySelector("svg");
    if (!svg) return;

    const serialized = new XMLSerializer().serializeToString(svg);
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = QR_PNG_SIZE;
      canvas.height = QR_PNG_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // White ground: a transparent PNG prints as nothing on some printers, and
      // QR readers need the light modules to actually be light.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, QR_PNG_SIZE, QR_PNG_SIZE);
      ctx.drawImage(image, 0, 0, QR_PNG_SIZE, QR_PNG_SIZE);

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${patchId || "karigari-patch"}.png`;
      link.click();
    };
    image.src = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(serialized)))}`;
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loaded) => {
      if (typeof loaded.target?.result === "string") {
        setPhoto(loaded.target.result);
        setReason(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!photo) return;
    setSubmitting(true);
    setReason(null);
    setScanned(null);
    try {
      const res = await fetch("/api/items/attach-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftItemId: item.id, imageBase64: photo }),
      });
      const data = await res.json();
      if (data?.success) {
        setVerified(true);
        onVerified();
      } else {
        setReason(data?.reason || t("qr_verify_failed"));
        setScanned(
          data?.expectedPatchId
            ? { got: data.scannedPatchId ?? null, expected: data.expectedPatchId }
            : null
        );
      }
    } catch (error) {
      console.error("Patch verification failed:", error);
      setReason(t("qr_verify_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-card w-full sm:max-w-lg max-h-[92vh] sm:rounded-3xl rounded-t-3xl overflow-hidden flex flex-col shadow-2xl">
        <div className="bg-primary text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <QrCode size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-lg leading-tight">{t("qr_modal_title")}</h2>
              <p className="text-xs text-white/70 truncate">{item.craftType}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close_btn")}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {verified ? (
            <div className="text-center py-6">
              <CheckCircle2 size={44} className="mx-auto mb-4 text-primary" />
              <h3 className="font-serif font-bold text-xl text-primary mb-2">
                {t("qr_verified_title")}
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-6">
                {t("qr_verified_body")}
              </p>
              <button
                onClick={onClose}
                className="bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-xl font-bold transition-colors"
              >
                {t("done")}
              </button>
            </div>
          ) : (
            <>
              {/* Step 1 — print the patch */}
              <section>
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                  {t("qr_step_1")}
                </p>
                <div className="bg-[var(--color-mint)]/50 border border-[var(--color-sage)]/50 rounded-2xl p-5 flex flex-col sm:flex-row gap-5 items-center">
                  <div ref={qrWrapRef} className="bg-white p-3 rounded-xl shrink-0">
                    {patchId ? (
                      <QRCode value={verifyUrl} size={128} />
                    ) : (
                      <div className="w-32 h-32 flex items-center justify-center text-gray-400">
                        <QrCode size={32} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 text-center sm:text-left">
                    <p className="text-[11px] font-mono text-gray-500 mb-2 break-all">{patchId}</p>
                    <p className="text-sm text-primary leading-relaxed mb-4">
                      {t("qr_step_1_body")}
                    </p>
                    <button
                      onClick={downloadQr}
                      disabled={!patchId}
                      className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
                    >
                      <Download size={16} /> {t("qr_download")}
                    </button>
                  </div>
                </div>
              </section>

              {/* Step 2 — photograph the patched piece */}
              <section>
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                  {t("qr_step_2")}
                </p>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">{t("qr_step_2_body")}</p>

                {photo ? (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-200 aspect-[4/3] bg-gray-100">
                    <Image src={photo} alt="" fill unoptimized className="object-cover" />
                    <button
                      onClick={() => {
                        setPhoto(null);
                        setReason(null);
                        setScanned(null);
                      }}
                      aria-label={t("remove")}
                      className="absolute top-2 right-2 p-2 bg-white/90 hover:bg-white rounded-full shadow-sm transition-colors"
                    >
                      <Trash2 size={16} className="text-red-600" />
                    </button>
                  </div>
                ) : (
                  <label
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-sage)]",
                      "bg-[var(--color-mint)]/30 hover:bg-[var(--color-mint)]/60 transition-colors cursor-pointer py-10 px-6 text-center"
                    )}
                  >
                    <div className="flex gap-3 text-primary">
                      <Camera size={24} />
                      <UploadCloud size={24} />
                    </div>
                    <span className="text-sm font-bold text-primary">{t("qr_upload_cta")}</span>
                    <span className="text-xs text-gray-500">{t("qr_upload_hint")}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={onFile}
                    />
                  </label>
                )}
              </section>

              {reason && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 p-4">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-700" />
                  <p className="text-sm text-red-700 leading-relaxed">{reason}</p>
                  {scanned && (
                    <dl className="mt-3 space-y-1 border-t border-red-200/70 pt-3 font-mono text-[11px] text-red-800">
                      <div className="flex justify-between gap-3">
                        <dt className="opacity-70">{t("qr_scanned_label")}</dt>
                        <dd className="text-right break-all">{scanned.got ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="opacity-70">{t("qr_expected_label")}</dt>
                        <dd className="text-right break-all">{scanned.expected}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}

              <button
                onClick={submit}
                disabled={!photo || submitting}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-bold transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> {t("qr_verifying")}
                  </>
                ) : (
                  <>
                    <ShieldIcon /> {t("qr_submit")}
                  </>
                )}
              </button>

              <p className="text-[11px] text-gray-500 italic leading-relaxed">
                {t("qr_honesty_note")}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small inline mark so the submit button reads as a verification action. */
function ShieldIcon() {
  return <CheckCircle2 size={18} />;
}
