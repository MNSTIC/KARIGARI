"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Check, Fingerprint, Loader2, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { MotifDisclaimer } from "@/components/MotifDisclaimer";
import { fill } from "@/components/buyer/passportFormat";
import { formatHash } from "@/lib/motifHash";
import type { PublicMotif } from "@/lib/motifLicence";

/**
 * The human half of the motif register, inside the facilitator console.
 *
 * A perceptual hash is a reason to look, never a verdict, so this is where every
 * registration actually becomes one. The flagged pair is presented as two
 * records and a distance — deliberately with no "original" and no "copy", and no
 * word suggesting one cluster took anything from the other. Two villages can
 * carry the same tradition, and this platform has no standing to rule on which
 * came first; what a reviewer decides is whether each record stands, not who
 * owns a pattern.
 */

interface Review extends PublicMotif {
  duplicateDistance: number | null;
  adminNote: string | null;
  craftItemId: string | null;
  reviewedAt: string | null;
  counterpart: PublicMotif | null;
}

const IST_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
};

function Crop({ motif, caption }: { motif: PublicMotif; caption: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{caption}</p>
      {motif.referenceImageUrl ? (
        <span className="relative mt-1.5 block h-28 w-full overflow-hidden rounded-xl border border-gray-200">
          <Image src={motif.referenceImageUrl} alt={motif.name} fill sizes="240px" unoptimized className="object-cover" />
        </span>
      ) : (
        <span className="mt-1.5 flex h-28 w-full items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-400">
          <Fingerprint size={18} aria-hidden />
        </span>
      )}
      <p className="mt-1.5 truncate text-[13px] font-semibold text-gray-900">{motif.name}</p>
      <p className="truncate text-[12px] text-gray-600">{motif.clusterName}</p>
      <p className="mt-0.5 font-mono text-[11px] tracking-wide text-gray-700">{formatHash(motif.hash)}</p>
    </div>
  );
}

export function MotifReviews({ onOpenCount }: { onOpenCount?: (count: number) => void }) {
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/motif-review", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setReviews(data.reviews ?? []);
      onOpenCount?.(data.openCount ?? 0);
    } catch (loadError) {
      setError((loadError as Error)?.message || "Could not load motif reviews.");
    } finally {
      setLoading(false);
    }
    // `onOpenCount` is a parent setState and is stable in practice; including it
    // would re-run this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const decide = async (id: string, status: "REGISTERED" | "REJECTED") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/motif-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, adminNote: notes[id] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      await load();
    } catch (decideError) {
      setError((decideError as Error)?.message || "Could not record that review.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="kg-shimmer h-[160px] rounded-2xl" aria-hidden />;

  return (
    <div className="space-y-5">
      <MotifDisclaimer />

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}

      {reviews.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-gray-600">{t("motif_review_empty")}</p>
      ) : (
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li key={review.id}>
              <Card pad="lg">
                <div className="flex flex-wrap items-center gap-2">
                  <SectionEyebrow>{t("motif_review_heading")}</SectionEyebrow>
                  <Badge variant={review.status === "FLAGGED_DUPLICATE" ? "warning" : "neutral"}>
                    {t(review.status === "FLAGGED_DUPLICATE" ? "motif_status_flagged" : "motif_status_pending")}
                  </Badge>
                  <span className="text-[11px] text-gray-500">
                    {new Date(review.registeredAt).toLocaleString("en-IN", IST_DAY)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-4">
                  <Crop motif={review} caption={t("motif_review_this")} />
                  {review.counterpart && <Crop motif={review.counterpart} caption={t("motif_review_other")} />}
                </div>

                {review.counterpart && typeof review.duplicateDistance === "number" && (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
                    {fill(t("motif_review_distance"), { distance: review.duplicateDistance })}
                  </p>
                )}

                <label className="mt-3 block">
                  <span className="text-[12px] font-semibold text-gray-700">{t("motif_admin_note")}</span>
                  <input
                    value={notes[review.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [review.id]: e.target.value })}
                    maxLength={400}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-card px-3 text-[14px]"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === review.id}
                    onClick={() => void decide(review.id, "REGISTERED")}
                    className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    {busyId === review.id ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Check size={14} aria-hidden />
                    )}
                    {t("motif_review_confirm")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === review.id}
                    onClick={() => void decide(review.id, "REJECTED")}
                    className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 bg-card px-3.5 text-[13px] font-semibold text-gray-800 disabled:opacity-50"
                  >
                    <X size={14} aria-hidden /> {t("motif_review_reject")}
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
