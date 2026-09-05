"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, ImagePlus, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { QrScanModal } from "@/components/QrScanModal";
import {
  BuyerVerifyResult,
  isFullyVerified,
  type BuyerVerifyResultShape,
} from "@/components/BuyerVerifyResult";
import { DEFAULT_BUYER, readBuyerContact, readBuyerName } from "@/lib/buyerIdentity";
import { buildPassportUrl } from "@/lib/qrPatch";
import { useLanguage } from "@/lib/translations";
import { MAX_UPLOAD_BYTES, readFileAsDataUrl } from "@/lib/fileToDataUrl";
import { prepareImage } from "@/lib/clientImagePrep";
import { cn } from "@/lib/utils";

/**
 * Standalone scan-and-verify page.
 *
 * Reached from the camera icon on My Orders, and usable on its own: a buyer can
 * scan any piece they bought without first picking an order. `?demandId=` is
 * optional — when present and owned by this buyer, the API also records the
 * delivery verification against that demand.
 *
 * The failure path is the point of this screen: when the AI says the delivered
 * piece is not what the artisan captured, the buyer gets a Report button that
 * opens an admin ticket.
 */

/* The 2 MB ceiling and the reader are shared with every other upload surface —
   see src/lib/fileToDataUrl.ts. */

/**
 * How long the passing result card stays on screen before the passport opens.
 * Long enough to read the checks, short enough that it still feels like one
 * continuous "scan -> proof -> provenance" flow.
 */
const PASSPORT_FORWARD_MS = 3500;

export default function BuyerVerifyPage() {
  const { t } = useLanguage();

  const [buyerName, setBuyerName] = useState(DEFAULT_BUYER);
  const [buyerContact, setBuyerContact] = useState("");
  const [demandId, setDemandId] = useState<string | null>(null);

  const [patchId, setPatchId] = useState("");
  /** Set only when a QR supplied the id, so the API can run the qrValid check. */
  const [scannedPatchId, setScannedPatchId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BuyerVerifyResultShape | null>(null);
  const [craftItemId, setCraftItemId] = useState<string | null>(null);

  const [reporting, setReporting] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  /** Set once a scan passes; drives the countdown to the passport. */
  const [forwarding, setForwarding] = useState(false);

  const router = useRouter();

  /**
   * Forward to the Digital Craft Passport after a passing scan.
   *
   * The QR sticker points here, not at the passport, so this is the step that
   * actually opens provenance to someone holding the piece. Cleared on unmount
   * so a buyer who navigates away mid-countdown is not yanked back.
   */
  useEffect(() => {
    if (!forwarding) return;
    const code = patchId.trim();
    if (!code) return;
    const timer = setTimeout(() => {
      router.push(buildPassportUrl(window.location.origin, code));
    }, PASSPORT_FORWARD_MS);
    return () => clearTimeout(timer);
  }, [forwarding, patchId, router]);

  // Identity + deep-link params are read in a deferred effect rather than via
  // useSearchParams, so this fully client page needs no Suspense boundary —
  // the same pattern the rest of the buyer surface uses.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const savedName = readBuyerName();
      if (savedName) setBuyerName(savedName);
      setBuyerContact(readBuyerContact());

      const params = new URLSearchParams(window.location.search);
      setDemandId(params.get("demandId"));
      const fromQr = params.get("patchId");
      if (fromQr) {
        setPatchId(fromQr);
        // Arriving with ?scan=1 means a QR, not a hand-typed code.
        if (params.get("scan") === "1") setScannedPatchId(fromQr);
      }
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const onPatchIdScanned = useCallback((scanned: string) => {
    setPatchId(scanned);
    setScannedPatchId(scanned);
  }, []);

  const onPhotoPicked = useCallback((dataUrl: string) => {
    setPhoto(dataUrl);
    setError("");
  }, []);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is over 2 MB.`);
      return;
    }
    // Downscaled in the browser: on a 2G link this is the difference between
    // a few seconds and a few minutes of upload.
    setPhoto(await prepareImage(file));
    setError("");
  };

  const submit = async () => {
    if (!patchId.trim() || !photo) {
      setError(t("verify_missing_fields"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/buyer/verify-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patchId: patchId.trim(),
          buyerName,
          scannedImageBase64: photo,
          demandId: demandId || undefined,
          scannedPatchId: scannedPatchId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("verification_failed"));
        return;
      }
      setResult({
        patchIdValid: Boolean(data.patchIdValid),
        productMatch: Boolean(data.productMatch),
        artisanMatch: Boolean(data.artisanMatch),
        qrValid: Boolean(data.qrValid),
        qrChecked: Boolean(data.qrChecked),
        similarityScore: Number(data.similarityScore) || 0,
        reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
        artisanName: typeof data.artisanName === "string" ? data.artisanName : null,
      });
      setCraftItemId(typeof data.craftItemId === "string" ? data.craftItemId : null);
      setTicketId(null);

      // A passing scan is what unlocks the passport. The forward is delayed a
      // few seconds on purpose: the three/four-check card is the evidence the
      // person is entitled to see, and yanking them away instantly would hide
      // the very thing they scanned to find out.
      const passed =
        Boolean(data.patchIdValid) &&
        Boolean(data.productMatch) &&
        Boolean(data.artisanMatch) &&
        (!data.qrChecked || Boolean(data.qrValid));
      if (passed) {
        setForwarding(true);
      }
    } catch (e) {
      console.error("Verify failed:", e);
      setError(t("verification_failed"));
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    if (!craftItemId || !photo || !result) return;
    setReporting(true);
    setError("");
    try {
      const res = await fetch("/api/buyer/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftItemId,
          patchId: patchId.trim(),
          buyerName,
          buyerContact: buyerContact || undefined,
          demandId: demandId || undefined,
          buyerImageUrl: photo,
          similarityScore: result.similarityScore,
          aiReasoning: result.reasoning,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("verification_failed"));
        return;
      }
      setTicketId(String(data.ticketId));
    } catch (e) {
      console.error("Report failed:", e);
      setError(t("verification_failed"));
    } finally {
      setReporting(false);
    }
  };

  // The report button exists only on a genuine failure with a resolved item —
  // there is nothing to report when the patch never matched a piece at all.
  const canReport = Boolean(result && !isFullyVerified(result) && craftItemId && !ticketId);
  const canSubmit = patchId.trim().length > 0 && !!photo && !busy;

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-16 font-sans">
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-gray-200/60 bg-[var(--color-background)]/90 px-4 py-4 backdrop-blur-md sm:px-8">
        <Link
          href="/buyer?tab=orders"
          className="kg-press rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          aria-label={t("close_btn")}
        >
          <ArrowLeft size={20} />
        </Link>
        <KarigariLogo variant="dark" showWordmark={false} size={26} />
        <span className="truncate font-bold tracking-wide text-primary">
          {t("scan_and_verify")}
        </span>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="kg-display text-[28px] leading-tight text-gray-900 sm:text-[34px]">
          {t("scan_verify_title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          {/* Someone who arrived by scanning the sticker needs to be told what
              this gate is and why it stands between them and the passport. */}
          {scannedPatchId ? t("scan_gate_lede") : t("scan_verify_lede")}
        </p>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-card">
          {/* ---------------- patch id ---------------- */}
          <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-gray-500">
            {t("enter_patch_id")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={patchId}
              onChange={(e) => {
                setPatchId(e.target.value);
                // A hand-edited code is no longer a scanned one.
                setScannedPatchId(null);
              }}
              placeholder="P-XXXXXX"
              className="min-h-[44px] flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              title={t("scan_qr_code")}
              aria-label={t("scan_qr_code")}
              className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--color-mint)] px-4 text-xs font-bold text-primary hover:bg-[var(--color-sage)]/40"
            >
              <Camera size={16} /> {t("scan_qr_code")}
            </button>
          </div>

          {scannedPatchId && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-mint)] px-2.5 py-1 text-[11px] font-bold text-primary">
              <ShieldCheck size={12} /> {t("scanned_via_qr")}
            </p>
          )}

          {/* ---------------- photo ---------------- */}
          <label className="kg-press mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-7 text-sm font-bold text-gray-500 hover:border-primary hover:text-primary">
            <ImagePlus size={16} />
            {photo ? `${t("upload_received_photo")} ✓` : t("upload_received_photo")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>

          {photo && (
            <div className="relative mx-auto mt-4 h-40 w-40 overflow-hidden rounded-xl border border-gray-200">
              <Image src={photo} alt="" fill sizes="160px" unoptimized className="object-cover" />
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "kg-press mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-dark",
              !canSubmit && "cursor-not-allowed opacity-50"
            )}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            <ShieldCheck size={16} /> {t("verify_product")}
          </button>
        </div>

        {/* ---------------- result ---------------- */}
        {result && (
          <div className="mt-6 space-y-4">
            <BuyerVerifyResult result={result} patchId={patchId.trim()} t={t} />

            {/* Passed — this is what the QR was for. The link is always here
                so nobody has to wait out the countdown, and the countdown is
                there so a scan that passes still ends up on the passport
                without a second tap. */}
            {isFullyVerified(result) && patchId.trim() && (
              <div className="rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-4">
                <Link
                  href={`/verify/${encodeURIComponent(patchId.trim())}?scan=1`}
                  className="kg-press inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-dark"
                >
                  <ShieldCheck size={16} /> {t("open_craft_passport")}
                </Link>
                {forwarding && (
                  <p className="mt-2 flex items-center justify-center gap-2 text-[11px] font-medium text-primary/80">
                    <Loader2 size={11} className="animate-spin" />
                    {t("opening_craft_passport")}
                  </p>
                )}
              </div>
            )}

            {canReport && (
              <button
                type="button"
                onClick={report}
                disabled={reporting}
                className={cn(
                  "kg-press inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-bold text-white hover:bg-red-700",
                  reporting && "cursor-not-allowed opacity-60"
                )}
              >
                {reporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ShieldAlert size={16} />
                )}
                {reporting ? t("report_submitting") : t("report_product")}
              </button>
            )}

            {ticketId && (
              <div className="rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-primary">
                  <ShieldCheck size={16} /> {t("report_submitted_title")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-primary/80">
                  {t("report_submitted_body")}
                </p>
                <p className="mt-2 font-mono text-[11px] text-primary/70">
                  {t("report_ticket_id")}: {ticketId}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      <QrScanModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPatchId={onPatchIdScanned}
        onPhoto={onPhotoPicked}
        t={t}
      />
    </div>
  );
}
