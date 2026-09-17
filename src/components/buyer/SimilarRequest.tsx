"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CheckCircle2, Loader2, MessageSquarePlus } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { prepareImage } from "@/lib/clientImagePrep";
import { readBuyerName, rememberBuyer } from "@/lib/buyerIdentity";
import { Card } from "@/components/ui/Card";
import type { DemandDraft } from "@/lib/demandDraft";
import type { PostedDemand } from "@/components/PostDemandModal";
import { fill } from "@/components/buyer/passportFormat";

/** Interaction-only, so the ~1,200-line form is not in the passport's first load. */
const PostDemandModal = dynamic(() => import("@/components/PostDemandModal").then((m) => m.PostDemandModal), {
  ssr: false,
});

/**
 * "Want something similar?" — a buyer request that starts from the piece on
 * screen.
 *
 * The prefill (craft, category, product type, material, colour) is computed on
 * the server from this piece; the reference photo is fetched here and turned
 * into the data URL POST /api/demand requires. Everything stays editable and
 * nothing is sent until the buyer posts it. The confirmation repeats what the
 * server actually did: the `notified` count from the artisan fan-out, or that
 * no artisan matched yet.
 */
export function SimilarRequest({ draft, imageSrc }: { draft: Partial<DemandDraft>; imageSrc: string | null }) {
  const { t } = useLanguage();
  const [preparing, setPreparing] = useState(false);
  const [initial, setInitial] = useState<Partial<DemandDraft> | null>(null);
  const [result, setResult] = useState<{ notified: number } | null>(null);
  const [buyerName, setBuyerName] = useState("");

  const open = async () => {
    setPreparing(true);
    setResult(null);
    let referenceImageUrls: string[] = [];
    if (imageSrc) {
      try {
        const res = await fetch(imageSrc);
        if (res.ok) {
          const blob = await res.blob();
          if (blob.type.startsWith("image/")) {
            referenceImageUrls = [await prepareImage(new File([blob], "reference", { type: blob.type }))];
          }
        }
      } catch (error) {
        // The request is still worth posting without a photo; the form shows
        // no reference image rather than a broken one.
        console.warn("[similar request] reference photo unavailable:", (error as Error)?.message);
      }
    }
    setBuyerName(readBuyerName());
    setInitial({ ...draft, referenceImageUrls });
    setPreparing(false);
  };

  const posted = (demand: PostedDemand, notified: number) => {
    if (demand.buyerName) rememberBuyer(demand.buyerName);
    setResult({ notified });
  };

  return (
    <section aria-labelledby="passport-similar">
      <Card pad="lg" className="kg-enter">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="passport-similar" className="kg-display text-[22px] leading-tight text-gray-900">
              {t("similar_request_title")}
            </h2>
            <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-gray-600">{t("similar_request_body")}</p>
          </div>
          <button
            type="button"
            onClick={() => void open()}
            disabled={preparing}
            className="kg-press inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
          >
            {preparing ? <Loader2 size={16} className="animate-spin" /> : <MessageSquarePlus size={16} />}
            {preparing ? t("similar_request_preparing") : t("similar_request_cta")}
          </button>
        </div>

        <div role="status" aria-live="polite">
          {result && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-700" aria-hidden />
              <p className="text-[13px] leading-relaxed text-green-800">
                {result.notified > 0 ? fill(t("similar_request_notified"), { n: result.notified }) : t("similar_request_no_match")}{" "}
                <Link href="/buyer" className="font-semibold underline underline-offset-2">
                  {t("similar_request_view")}
                </Link>
              </p>
            </div>
          )}
        </div>
      </Card>

      {initial && (
        <PostDemandModal
          isOpen
          initial={initial}
          defaultBuyerName={buyerName}
          onClose={() => setInitial(null)}
          onPosted={posted}
        />
      )}
    </section>
  );
}
