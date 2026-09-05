"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { parseScannedPatchId } from "@/lib/qrPatch";
import { cn } from "@/lib/utils";

/**
 * Full-screen, mobile-first camera sheet for the buyer's scan-and-verify flow.
 *
 * Two jobs in one surface, because on a phone they are one action:
 *   1. Decode the patch QR and hand the patch id back (`onPatchId`).
 *   2. Capture a photo of the piece that actually arrived (`onPhoto`).
 *
 * Every failure path stays usable: if the camera is denied, or no QR shows up,
 * the sheet says so and the caller's manual patch-id field keeps working. The
 * file input (`capture="environment"`) is the baseline that works on every
 * phone browser with no extra permissions dance.
 */

/** How long to hunt for a QR before telling the buyer to type the code. */
const QR_TIMEOUT_MS = 15000;
/** Gap between decode attempts. Fast enough to feel instant, cheap enough to idle. */
const DECODE_INTERVAL_MS = 400;
/** Captured frames are downscaled to this long edge before becoming a data URL. */
const CAPTURE_MAX_EDGE = 1280;
/** JPEG quality for the captured frame — well inside the 2 MB upload cap. */
const CAPTURE_QUALITY = 0.82;

/**
 * `BarcodeDetector` is still not in TypeScript's DOM lib. Declared narrowly:
 * only the two members this file touches.
 */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

export function QrScanModal({
  isOpen,
  onClose,
  onPatchId,
  onPhoto,
  t,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Fired once a QR resolves to a patch id belonging to this origin. */
  onPatchId: (patchId: string) => void;
  /** Fired with a data URL of the photo the buyer captured or picked. */
  onPhoto: (dataUrl: string) => void;
  t: (key: string) => string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Stop every track. Called on close, on unmount, and after a decode. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  // Camera lifecycle. Everything started here is torn down in the cleanup, so
  // closing the sheet (or navigating away mid-scan) never leaves the torch on.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    let decodeTimer: ReturnType<typeof setInterval> | null = null;
    let hintTimer: ReturnType<typeof setTimeout> | null = null;
    /** zxing's own scan loop handle, stopped alongside the camera tracks. */
    let zxingControls: { stop: () => void } | null = null;

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of the client pages use.
    const reset = setTimeout(() => {
      setCameraError(false);
      setScanHint(null);
    }, 0);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* autoplay guards vary by browser; the frame still renders */
          });
        }
        setCameraReady(true);

        /** Shared handler: a decoded string that resolves to one of our patches. */
        const accept = (raw: string): boolean => {
          const patchId = parseScannedPatchId(raw, window.location.origin);
          if (!patchId) return false;
          if (decodeTimer) {
            clearInterval(decodeTimer);
            decodeTimer = null;
          }
          onPatchId(patchId);
          return true;
        };

        // Primary decoder: @zxing/browser. Works on every browser, including
        // the iOS Safari that still ships no BarcodeDetector.
        try {
          const { BrowserQRCodeReader } = await import("@zxing/browser");
          const reader = new BrowserQRCodeReader();
          const controls = await reader.decodeFromVideoElement(
            videoRef.current as HTMLVideoElement,
            (decodeResult) => {
              if (cancelled || !decodeResult) return;
              if (accept(decodeResult.getText())) {
                zxingControls?.stop();
              }
            }
          );
          if (cancelled) controls.stop();
          else zxingControls = controls;
        } catch (zxingError) {
          // Fallback: BarcodeDetector where the platform has it. Absent both,
          // the sheet is still a perfectly good camera — the buyer types the
          // code, which is exactly what the manual hint tells them to do.
          console.warn("[scan] zxing unavailable, falling back:", zxingError);
          const Ctor = barcodeDetectorCtor();
          if (Ctor) {
            const detector = new Ctor({ formats: ["qr_code"] });
            decodeTimer = setInterval(async () => {
              const video = videoRef.current;
              if (!video || video.readyState < 2) return;
              try {
                const found = await detector.detect(video);
                const raw = found?.[0]?.rawValue;
                if (raw) accept(raw);
              } catch {
                // A frame that fails to decode is the normal case, not an error.
              }
            }, DECODE_INTERVAL_MS);
          }
        }

        hintTimer = setTimeout(() => {
          if (!cancelled) setScanHint(t("scan_manual_hint"));
        }, QR_TIMEOUT_MS);
      } catch {
        if (!cancelled) {
          setCameraError(true);
          setScanHint(t("scan_camera_denied"));
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(reset);
      if (decodeTimer) clearInterval(decodeTimer);
      if (hintTimer) clearTimeout(hintTimer);
      zxingControls?.stop();
      zxingControls = null;
      stopStream();
    };
  }, [isOpen, onPatchId, stopStream, t]);

  /** Grab the current video frame, downscaled, as a JPEG data URL. */
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setBusy(true);
    try {
      const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onPhoto(canvas.toDataURL("image/jpeg", CAPTURE_QUALITY));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /** Baseline path — works on every phone browser, camera API or not. */
  const onFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onPhoto(String(reader.result));
      onClose();
    };
    reader.readAsDataURL(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-4 text-white">
        <p className="text-sm font-bold">{t("scan_and_verify")}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("scan_close_camera")}
          className="kg-press rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />

        {/* Reticle. Purely presentational, so it never blocks a tap. */}
        {cameraReady && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-56 rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Loader2 size={26} className="animate-spin" />
          </div>
        )}
      </div>

      <div className="space-y-3 bg-black px-4 pb-8 pt-4 text-center">
        <p className="text-xs leading-relaxed text-white/70">
          {scanHint || t("scan_pointing_hint")}
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={capturePhoto}
            disabled={!cameraReady || busy}
            className={cn(
              "kg-press inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-gray-900",
              (!cameraReady || busy) && "cursor-not-allowed opacity-40"
            )}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {t("upload_received_photo")}
          </button>

          <label className="kg-press inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-white/30 px-5 text-sm font-bold text-white hover:bg-white/10">
            <ImagePlus size={16} />
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
