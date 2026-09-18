"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Banknote, Check, Fingerprint, Loader2, X } from "lucide-react";
import { Shell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageLede, PageTitle, SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useLanguage } from "@/lib/translations";
import { fill } from "@/components/buyer/passportFormat";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { MotifDisclaimer } from "@/components/MotifDisclaimer";
import { MotifCard, type MotifCardData } from "@/components/motif/MotifCard";
import { dominantColours, downscaleReference, formatHash, hashImageDataUrl } from "@/lib/motifHash";
import type { TrustLedger } from "@/lib/motifRecord";

/**
 * The cluster's motif register, from inside the cluster.
 *
 * Four things, and the order is the argument: what the village already holds,
 * how to add to it, who has asked to use it, and what that has actually paid.
 *
 * The fingerprint is computed **in this browser**, from the piece's own photo,
 * before anything is sent. When the canvas is unavailable — some privacy modes
 * refuse `getImageData` — registration is disabled with the reason stated,
 * rather than filing a record with no fingerprint in it.
 *
 * Nothing on this page is a legal claim. `MotifDisclaimer` sits at the top and
 * says so in the artisan's own language.
 */

interface Piece {
  id: string;
  craftType: string;
  patchId: string | null;
  thumbnail: string | null;
  createdAt: string;
}

interface Licence {
  id: string;
  licenseeName: string;
  licenseeContact: string;
  intendedUse: string;
  scope: string | null;
  feeAmount: number | null;
  decisionNote: string | null;
  status: string;
  payoutMode: string | null;
  paidAt: string | null;
  createdAt: string;
  motif: { id: string; name: string; hash: string };
}

type HashState = "idle" | "working" | "ready" | "blocked";

const LICENCE_STATUS_KEY: Record<string, string> = {
  REQUESTED: "motif_licence_status_requested",
  ACCEPTED: "motif_licence_status_accepted",
  DECLINED: "motif_licence_status_declined",
  PAID: "motif_licence_status_paid",
  WITHDRAWN: "motif_licence_status_withdrawn",
};

export default function ArtisanMotifsPage() {
  const { t } = useLanguage();

  const [clusterName, setClusterName] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [motifs, setMotifs] = useState<MotifCardData[]>([]);
  const [ledger, setLedger] = useState<TrustLedger | null>(null);
  const [licences, setLicences] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- registration form -------------------------------------------------
  const [pieceId, setPieceId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [hashState, setHashState] = useState<HashState>("idle");
  const [palette, setPalette] = useState<string[]>([]);
  const [reference, setReference] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [mine, enquiries] = await Promise.all([
        fetch("/api/artisan/motifs", { cache: "no-store" }),
        fetch("/api/artisan/motif-licence", { cache: "no-store" }),
      ]);
      const data = await mine.json();
      if (mine.ok && data?.success) {
        setClusterName(data.clusterName);
        setPieces(data.pieces ?? []);
        setMotifs(data.motifs ?? []);
        setLedger(data.ledger ?? null);
      }
      const enquiryData = await enquiries.json().catch(() => null);
      if (enquiries.ok && enquiryData?.success) setLicences(enquiryData.licences ?? []);
    } catch (error) {
      console.warn("[motifs] unavailable:", (error as Error)?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same pattern the rest of this app uses for a kickoff.
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  /**
   * Fingerprint the chosen piece, here, before anything is sent.
   *
   * The photo is fetched from the thumbnail route and drawn to a canvas. If the
   * canvas refuses — a blocked or privacy-restricted context — the state goes to
   * `blocked` and the submit button stays disabled, because a registration with
   * no fingerprint is not a registration.
   */
  const choosePiece = async (piece: Piece) => {
    setPieceId(piece.id);
    setHash(null);
    setPalette([]);
    setReference(null);
    setNotice(null);

    if (!piece.thumbnail) {
      setHashState("blocked");
      return;
    }

    setHashState("working");
    try {
      const res = await fetch(piece.thumbnail, { cache: "no-store" });
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("could not read the photo"));
        reader.readAsDataURL(blob);
      });

      // The fingerprint comes from the FULL photo — dHash draws to a 9x8 grid,
      // so the value is the same either way — while what gets stored and sent
      // for reading is a small crop.
      const fingerprint = await hashImageDataUrl(dataUrl);
      if (!fingerprint) {
        setHashState("blocked");
        return;
      }
      setHash(fingerprint);
      setReference(await downscaleReference(dataUrl));
      setPalette(await dominantColours(dataUrl));
      setHashState("ready");
      if (!name) setName(piece.craftType);
    } catch (error) {
      console.warn("[motifs] fingerprint failed:", (error as Error)?.message);
      setHashState("blocked");
    }
  };

  const register = async () => {
    if (!hash || !name.trim()) return;
    setSubmitting(true);
    setNotice(null);
    try {
      // Ask the model what it sees, but never wait on it to register: a reading
      // that does not arrive becomes the browser's own colour histogram, and the
      // record says which one it got.
      let descriptors: unknown = { palette };
      let descriptorSource: "AI" | "HEURISTIC" = "HEURISTIC";
      try {
        const described = await fetch("/api/motif/describe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referenceImageUrl: reference }),
        });
        const read = await described.json();
        if (read?.descriptors && read?.source === "AI") {
          descriptors = read.descriptors;
          descriptorSource = "AI";
        }
      } catch {
        // Keep the histogram.
      }

      const res = await fetch("/api/motif/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftItemId: pieceId,
          name: name.trim(),
          hash,
          descriptors,
          descriptorSource,
          referenceImageUrl: reference,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        setNotice({
          tone: "error",
          text:
            data?.code === "ALREADY_REGISTERED"
              ? fill(t("motif_already_registered"), { name: data.existingName ?? "", distance: data.distance ?? 0 })
              : data?.error || t("network_error_retry"),
        });
        return;
      }

      setNotice({
        tone: "ok",
        text: data.motif.status === "FLAGGED_DUPLICATE" ? t("motif_filed_flagged") : t("motif_filed_pending"),
      });
      setPieceId(null);
      setHash(null);
      setReference(null);
      setName("");
      setHashState("idle");
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: (error as Error)?.message || t("network_error_retry") });
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (id: string, action: "accept" | "decline", feeAmount?: number, note?: string) => {
    try {
      const res = await fetch("/api/artisan/motif-licence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, feeAmount, note }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setNotice({ tone: "error", text: data?.error || t("network_error_retry") });
        return;
      }
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: (error as Error)?.message || t("network_error_retry") });
    }
  };

  return (
    <Shell>
      <div className="mb-6">
        <PageTitle>{t("motif_title")}</PageTitle>
        <PageLede>
          {clusterName ? fill(t("motif_lede"), { cluster: clusterName }) : t("motif_lede_generic")}
        </PageLede>
      </div>

      <MotifDisclaimer className="mb-7" />

      {notice && (
        <p
          role="status"
          className={cn(
            "mb-5 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed",
            notice.tone === "ok" ? "bg-[var(--color-mint)]/60 text-gray-800" : "bg-red-50 text-red-800"
          )}
        >
          {notice.text}
        </p>
      )}

      {/* ------------------------------------------------------- register */}
      <Card as="section" pad="lg" radius="3xl" className="kg-enter" aria-label={t("motif_register_cta")}>
        <SectionEyebrow>{t("motif_register_cta")}</SectionEyebrow>
        <p className="mt-1.5 text-[14px] leading-relaxed text-gray-600">{t("motif_register_help")}</p>

        {pieces.length === 0 ? (
          <p className="mt-3 text-[14px] text-gray-600">{t("motif_no_pieces")}</p>
        ) : (
          <>
            <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
              {t("motif_pick_piece")}
            </p>
            <ul className="kg-rail -mx-1 mt-2 flex gap-2.5 overflow-x-auto px-1 pb-2">
              {pieces.map((piece) => (
                <li key={piece.id} className="w-[104px] shrink-0">
                  <button
                    type="button"
                    onClick={() => void choosePiece(piece)}
                    aria-pressed={pieceId === piece.id}
                    className={cn(
                      "block w-full rounded-xl border-2 p-1 text-left transition",
                      pieceId === piece.id ? "border-[var(--color-maroon)]" : "border-gray-200 hover:border-gray-300"
                    )}
                  >
                    {piece.thumbnail ? (
                      // `fill` inside a sized box: passing width/height and then
                      // resizing with CSS makes Next warn about the aspect ratio.
                      <span className="relative block h-24 w-full overflow-hidden rounded-lg">
                        <Image
                          src={piece.thumbnail}
                          alt={piece.craftType}
                          fill
                          sizes="104px"
                          unoptimized
                          className="object-cover"
                        />
                      </span>
                    ) : (
                      <span className="flex h-24 w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                        <Fingerprint size={18} aria-hidden />
                      </span>
                    )}
                    <span className="mt-1 block truncate text-[11px] text-gray-700">{piece.craftType}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {pieceId && (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[13px] font-semibold text-gray-800">{t("motif_name")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder={t("motif_name_placeholder")}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-card px-3 text-[15px]"
              />
            </label>

            <div className="rounded-xl bg-gray-50 px-3 py-2.5" role="status">
              {hashState === "working" && (
                <p className="flex items-center gap-2 text-[13px] text-gray-700">
                  <Loader2 size={14} className="animate-spin" aria-hidden /> {t("motif_hashing")}
                </p>
              )}
              {hashState === "ready" && hash && (
                <>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                    {t("motif_fingerprint")}
                  </p>
                  <p className="mt-1 font-mono text-[13px] tracking-wide text-gray-800">{formatHash(hash)}</p>
                  {palette.length > 0 && (
                    <span className="mt-2 flex overflow-hidden rounded-full" aria-hidden>
                      {palette.map((colour) => (
                        <span key={colour} className="h-3.5 w-6" style={{ backgroundColor: colour }} />
                      ))}
                    </span>
                  )}
                </>
              )}
              {hashState === "blocked" && (
                <p className="text-[13px] leading-relaxed text-[var(--color-rust)]">{t("motif_hash_blocked")}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void register()}
              disabled={submitting || hashState !== "ready" || !name.trim()}
              className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Fingerprint size={15} aria-hidden />}
              {t("motif_register_submit")}
            </button>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------- the register */}
      <section className="mt-8" aria-label={t("motif_cluster_register")}>
        <SectionEyebrow>{t("motif_cluster_register")}</SectionEyebrow>
        {loading ? (
          <div className="kg-shimmer mt-3 h-[120px] rounded-2xl" aria-hidden />
        ) : motifs.length === 0 ? (
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t("motif_register_empty")}</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {motifs.map((motif) => (
              <li key={motif.id} className="min-w-0">
                <MotifCard
                  motif={motif}
                  footer={
                    motif.status === "REGISTERED" ? (
                      <Link
                        href={`/motif/${motif.id}`}
                        className="inline-flex min-h-[40px] items-center text-[13px] font-semibold text-[var(--color-maroon)] underline underline-offset-2"
                      >
                        {t("motif_view_public")}
                      </Link>
                    ) : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- enquiries */}
      <section className="mt-8" aria-label={t("motif_licence_request")}>
        <SectionEyebrow>{t("motif_licence_request")}</SectionEyebrow>
        {licences.length === 0 ? (
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t("motif_licence_empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {licences.map((licence) => (
              <LicenceRow key={licence.id} licence={licence} onDecide={decide} />
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- trust ledger */}
      <section className="mt-8" aria-label={t("motif_trust_ledger")}>
        <SectionEyebrow>{t("motif_trust_ledger")}</SectionEyebrow>
        <Card pad="lg" radius="3xl" className="mt-3">
          {!ledger || ledger.clusterTotal === 0 ? (
            <p className="text-[14px] leading-relaxed text-gray-600">{t("motif_trust_empty")}</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-gray-500">{t("motif_trust_total")}</p>
                  <p className="kg-display text-[28px] leading-tight text-gray-900">
                    {formatRupees(ledger.clusterTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] uppercase tracking-wide text-gray-500">{t("motif_trust_your_share")}</p>
                  <p className="kg-display text-[28px] leading-tight text-gray-900">
                    {formatRupees(ledger.yourTotal)}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-2">
                {ledger.rows.map((row) => (
                  <li key={row.licenceId} className="flex flex-wrap items-center gap-2 text-[13px] text-gray-700">
                    <Banknote size={14} className="shrink-0 text-gray-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{row.motifName}</span>
                    <span className="font-semibold tabular-nums">{formatRupees(row.amount)}</span>
                    <Badge variant={row.payoutMode === "RAZORPAYX" ? "success" : "neutral"}>
                      {t(row.payoutMode === "RAZORPAYX" ? "motif_payout_real" : "motif_payout_simulated")}
                    </Badge>
                  </li>
                ))}
              </ul>

              {ledger.simulatedTotal > 0 && (
                <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
                  {fill(t("motif_payout_simulated_note"), { amount: formatRupees(ledger.simulatedTotal) })}
                </p>
              )}
            </>
          )}
        </Card>
      </section>
    </Shell>
  );
}

function LicenceRow({
  licence,
  onDecide,
}: {
  licence: Licence;
  onDecide: (id: string, action: "accept" | "decline", feeAmount?: number, note?: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const open = licence.status === "REQUESTED";
  const feeValue = Number(fee);

  return (
    <li>
      <Card pad="md">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gray-900">{licence.motif.name}</p>
          <Badge variant={licence.status === "PAID" ? "success" : open ? "warning" : "neutral"}>
            {t(LICENCE_STATUS_KEY[licence.status] ?? "motif_licence_status_requested")}
          </Badge>
        </div>

        <p className="mt-1.5 text-[13px] text-gray-700">
          <span className="font-semibold">{licence.licenseeName}</span> · {licence.licenseeContact}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
          <span className="font-semibold">{t("motif_licence_use")}:</span> {licence.intendedUse}
        </p>
        {licence.scope && (
          <p className="mt-1 text-[12px] text-gray-600">
            <span className="font-semibold">{t("motif_licence_scope")}:</span> {licence.scope}
          </p>
        )}
        {licence.feeAmount !== null && (
          <p className="mt-1 text-[13px] text-gray-800">
            <span className="font-semibold">{t("motif_licence_fee")}:</span> {formatRupees(licence.feeAmount)}
          </p>
        )}
        {licence.decisionNote && (
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{licence.decisionNote}</p>
        )}
        {licence.status === "PAID" && (
          <p className="mt-1 text-[12px] text-gray-500">
            {t(licence.payoutMode === "RAZORPAYX" ? "motif_payout_real" : "motif_payout_simulated")}
          </p>
        )}

        {open && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0">
              <span className="block text-[12px] font-semibold text-gray-700">{t("motif_licence_fee")}</span>
              <input
                value={fee}
                onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="5000"
                className="mt-1 min-h-[44px] w-28 rounded-lg border border-gray-300 bg-card px-2.5 text-[14px] tabular-nums"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-gray-700">{t("motif_licence_note")}</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-card px-2.5 text-[14px]"
              />
            </label>
            <button
              type="button"
              disabled={busy || !Number.isInteger(feeValue) || feeValue <= 0}
              onClick={async () => {
                setBusy(true);
                await onDecide(licence.id, "accept", feeValue, note);
                setBusy(false);
              }}
              className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              <Check size={14} aria-hidden /> {t("motif_licence_accept")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onDecide(licence.id, "decline", undefined, note);
                setBusy(false);
              }}
              className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 bg-card px-3.5 text-[13px] font-semibold text-gray-800 disabled:opacity-50"
            >
              <X size={14} aria-hidden /> {t("motif_licence_decline")}
            </button>
          </div>
        )}
      </Card>
    </li>
  );
}
