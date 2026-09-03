"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { StarRating } from "@/components/ui/StarRating";
import { readBuyerContact, readBuyerName } from "@/lib/buyerIdentity";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Reviews on one product page.
 *
 * Two halves: the read side (average + list) is always shown; the write side
 * only unlocks when the buyer identity remembered in this browser matches an
 * actual paid `CraftItem`. Non-buyers see the "purchased only" note instead of
 * the form — the server enforces the same rule, so a curious viewer editing
 * the DOM cannot smuggle a review through.
 */

interface Review {
  id: string;
  buyerName: string;
  rating: number;
  comment: string | null;
  images: string[];
  createdAt: string;
}

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2_000_000;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ReviewSection({ craftItemId }: { craftItemId: string }) {
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [totalReviews, setTotalReviews] = useState(0);
  const [buyerName, setBuyerName] = useState("");
  const [buyerContact, setBuyerContact] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reviews?craftItemId=${encodeURIComponent(craftItemId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.success) {
        setReviews(data.reviews as Review[]);
        setAvgRating(typeof data.avgRating === "number" ? data.avgRating : null);
        setTotalReviews(data.totalReviews || 0);
      } else {
        setReviews([]);
      }
    } catch (e) {
      console.error("Reviews load failed:", e);
      setReviews([]);
    }
  }, [craftItemId]);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      setBuyerName(readBuyerName());
      setBuyerContact(readBuyerContact());
      void load();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  // Have I already reviewed this piece? Case-insensitive match against the
  // fetched list — cheap and correct, since the API caps at 50.
  const alreadyReviewed =
    !!buyerName &&
    (reviews || []).some(
      (r) => r.buyerName.trim().toLowerCase() === buyerName.trim().toLowerCase()
    );

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, room);
    const next: string[] = [];
    for (const file of picked) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" is over 2 MB.`);
        continue;
      }
      try {
        next.push(await readFileAsDataUrl(file));
      } catch {
        setError("One of the images could not be read.");
      }
    }
    setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (rating < 1) {
      setError(t("reviews_rating") + ": 1-5");
      return;
    }
    if (!buyerName.trim()) {
      setError(t("buyer_name_label"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftItemId,
          buyerName,
          buyerContact: buyerContact || undefined,
          rating,
          comment: comment || undefined,
          images,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("reviews_purchase_required"));
        return;
      }
      setToast(t("reviews_submitted"));
      setRating(0);
      setComment("");
      setImages([]);
      await load();
    } catch (e) {
      console.error("Review submit failed:", e);
      setError(t("orders_load_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-14">
      <h2 className="kg-display text-[26px] leading-tight text-gray-900">
        {t("reviews_title")}
      </h2>

      <div className="mt-3 flex items-center gap-3">
        <StarRating rating={avgRating ?? 0} size={18} />
        <span className="text-sm font-medium text-gray-700">
          {avgRating !== null ? avgRating.toFixed(1) : "—"}
        </span>
        <span className="text-xs text-gray-500">
          {t("reviews_count").replace("{count}", String(totalReviews))}
        </span>
      </div>

      {/* --------------------------------------------------------- Write */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-card">
        {!buyerName ? (
          <p className="text-sm text-gray-600">
            <ShieldCheck size={14} className="mr-1.5 inline-block text-gray-400" />
            {t("reviews_purchase_required")}
          </p>
        ) : alreadyReviewed ? (
          <p className="text-sm text-gray-600">
            <ShieldCheck size={14} className="mr-1.5 inline-block text-primary" />
            {t("reviews_already_reviewed")}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h3 className="text-sm font-bold text-gray-900">{t("reviews_write")}</h3>

            <div>
              <span className="kg-label font-medium text-gray-500">
                {t("reviews_rating")}
              </span>
              <div className="mt-1.5">
                <StarRating
                  rating={rating}
                  size={26}
                  interactive
                  onChange={setRating}
                  ariaLabel={t("reviews_rating")}
                />
              </div>
            </div>

            <div>
              <label htmlFor="review-comment" className="kg-label font-medium text-gray-500">
                {t("reviews_comment")}
              </label>
              <textarea
                id="review-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 p-3 text-[14px] text-gray-900 outline-none focus:border-primary"
              />
            </div>

            <div>
              <span className="kg-label font-medium text-gray-500">
                {t("reviews_images")}
              </span>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                {images.map((src, index) => (
                  <div
                    key={`${index}-${src.slice(0, 24)}`}
                    className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200"
                  >
                    <Image src={src} alt="" fill sizes="64px" unoptimized className="object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                      className="kg-press absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-lg bg-black/60 text-white"
                      aria-label="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {images.length < MAX_IMAGES && (
                  <label className="kg-press flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 hover:border-primary hover:text-primary">
                    <ImagePlus size={18} />
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleFiles(e.target.files)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-700">
                {error}
              </p>
            )}
            {toast && (
              <p className="rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] p-3 text-xs font-bold text-primary">
                {toast}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || rating < 1}
              className={cn(
                "kg-press flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("reviews_submit")}
            </button>
          </form>
        )}
      </div>

      {/* -------------------------------------------------- Review list */}
      <div className="mt-6 space-y-4">
        {reviews === null ? (
          <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-10 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : reviews.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            {t("reviews_no_reviews")}
          </p>
        ) : (
          reviews.map((review) => (
            <article
              key={review.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                    {review.buyerName}
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-mint)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                      <ShieldCheck size={11} /> {t("reviews_verified_buyer")}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {shortDate(review.createdAt)}
                  </p>
                </div>
                <StarRating rating={review.rating} size={14} />
              </div>

              {review.comment && (
                <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-gray-700">
                  {review.comment}
                </p>
              )}

              {review.images.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {review.images.map((src, index) => (
                    <div
                      key={`${review.id}-${index}`}
                      className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200"
                    >
                      <Image
                        src={src}
                        alt=""
                        fill
                        sizes="80px"
                        unoptimized={src.startsWith("data:")}
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
