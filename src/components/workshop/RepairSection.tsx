"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Hammer, Loader2, MessageSquarePlus, Send, Sparkles, Users, Wrench } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionEyebrow";
import { fill, passportDay } from "@/components/buyer/passportFormat";
import type { ToolingBrief, ToolingFamily } from "@/lib/toolingGuide";

/**
 * Repair & tooling.
 *
 * The honest answer to "who fixes this?" is somebody in the artisan's own
 * cluster, so the primary action posts a real `ResourceRequest` to the cluster
 * board and says how many people it will actually reach. Karigari has no
 * verified register of loom mechanics or kiln builders, and this tab invents
 * none: the AI brief beside it describes faults, local words and questions to
 * ask, and every contact detail is stripped from it server-side before it
 * arrives (src/lib/toolingGuide.ts).
 */

interface CuratedEntry {
  family: ToolingFamily;
  slug: string;
  partKey: string;
  symptomKey: string;
  askKey: string;
}

interface ClusterRequest {
  id: string;
  resourceName: string;
  description: string | null;
  quantity: string | null;
  createdAt: string;
  requesterName: string | null;
  mine: boolean;
}

interface ToolingPayload {
  success: true;
  source: "AI" | "CURATED";
  craftType: string | null;
  family: ToolingFamily;
  cluster: { key: string; named: boolean; memberCount: number } | null;
  requests: ClusterRequest[];
  brief: ToolingBrief | null;
  curated: CuratedEntry[];
}

export function RepairSection({ onGoToFunding }: { onGoToFunding: () => void }) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<ToolingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [need, setNeed] = useState("");
  const [detail, setDetail] = useState("");
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/artisan/tooling?lang=${encodeURIComponent(language)}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(`tooling ${res.status}`);
      setData(payload as ToolingPayload);
    } catch (error) {
      console.warn("[workshop] repair help unavailable:", (error as Error)?.message);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const ask = async () => {
    const resourceName = need.trim();
    if (!resourceName) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch("/api/artisan/resource-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Prefixed so the cluster board, and this tab's own filter, can tell a
        // repair need from a request for raw material.
        body: JSON.stringify({ resourceName: `Repair: ${resourceName}`, description: detail.trim() || null }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || `resource-request ${res.status}`);
      setPosted(resourceName);
      setNeed("");
      setDetail("");
      await load();
    } catch (error) {
      setPostError((error as Error)?.message || "failed");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="kg-shimmer h-[190px] rounded-2xl" />
        <div className="kg-shimmer h-[220px] rounded-2xl" />
      </div>
    );
  }

  if (failed || !data) {
    return (
      <Card pad="lg" className="border-dashed text-center">
        <AlertTriangle size={24} className="mx-auto mb-3 text-gray-400" />
        <p className="text-[14px] text-gray-600">{t("repair_load_failed")}</p>
      </Card>
    );
  }

  const reach = data.cluster?.memberCount ?? 0;
  const brief = data.brief;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ Ask my cluster */}
      <Card pad="lg">
        <SectionHeading size="sm">
          <span className="inline-flex items-center gap-2">
            <Users size={18} className="text-gray-500" aria-hidden /> {t("repair_ask_cluster")}
          </span>
        </SectionHeading>
        <p className="-mt-1 text-[14px] leading-relaxed text-gray-600">
          {reach === 0
            ? data.cluster
              ? t("repair_cluster_alone")
              : t("repair_no_cluster")
            : reach === 1
              ? t("repair_cluster_reach_one")
              : fill(t("repair_cluster_reach"), { n: reach })}
        </p>
        {reach === 0 && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">{t("repair_add_shg_hint")}</p>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="kg-label mb-1.5 block font-medium text-gray-600">{t("repair_need_label")}</span>
            <input
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              maxLength={100}
              placeholder={t("repair_need_placeholder")}
              className="w-full min-h-[44px] rounded-xl border border-gray-300 bg-card px-3.5 text-[14px] text-gray-900 outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="kg-label mb-1.5 block font-medium text-gray-600">{t("repair_detail_label")}</span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={400}
              rows={2}
              placeholder={t("repair_detail_placeholder")}
              className="w-full rounded-xl border border-gray-300 bg-card px-3.5 py-2.5 text-[14px] text-gray-900 outline-none focus:border-primary"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={ask}
              disabled={posting || !need.trim() || !data.cluster}
              className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
            >
              {posting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
              {t("repair_post_request")}
            </button>
            <button
              type="button"
              onClick={onGoToFunding}
              className="kg-press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-medium text-gray-600 underline underline-offset-2"
            >
              {t("repair_buy_instead")}
            </button>
          </div>
          {posted && (
            <p role="status" aria-live="polite" className="text-[13px] font-medium text-green-700">
              {reach === 1
                ? fill(t("repair_posted_one"), { need: posted })
                : fill(t("repair_posted"), { need: posted, n: reach })}
            </p>
          )}
          {postError && (
            <p role="alert" className="text-[13px] text-red-700">
              {t("repair_post_failed")}
            </p>
          )}
        </div>
      </Card>

      {/* --------------------------------------------- Open in the cluster */}
      <section aria-labelledby="repair-open">
        <SectionHeading id="repair-open" size="sm">
          {t("repair_open_requests")}
        </SectionHeading>
        {data.requests.length === 0 ? (
          <Card tone="muted" pad="lg" className="text-[14px] text-gray-600">
            {t("repair_no_open_requests")}
          </Card>
        ) : (
          <ul className="space-y-3">
            {data.requests.map((request) => (
              <li key={request.id}>
                <Card pad="md" className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900 [overflow-wrap:anywhere]">
                      {request.resourceName}
                    </p>
                    {request.description && (
                      <p className="mt-1 text-[13px] leading-relaxed text-gray-600 [overflow-wrap:anywhere]">
                        {request.description}
                      </p>
                    )}
                    <p className="mt-1.5 text-[12px] text-gray-500">
                      {request.mine
                        ? t("repair_request_mine")
                        : fill(t("repair_request_by"), { name: request.requesterName ?? "" })}
                      {" · "}
                      {passportDay(request.createdAt)}
                    </p>
                  </div>
                  {request.quantity && <Badge variant="outline">{request.quantity}</Badge>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- The brief */}
      <section aria-labelledby="repair-brief">
        <SectionHeading id="repair-brief" size="sm">
          <span className="inline-flex items-center gap-2">
            <Wrench size={18} className="text-gray-500" aria-hidden /> {t("repair_brief_title")}
          </span>
        </SectionHeading>

        <Card tone="muted" pad="lg">
          <Badge variant={brief ? "mint" : "neutral"} icon={brief ? <Sparkles size={11} /> : <Hammer size={11} />}>
            {brief ? t("repair_ai_label") : t("repair_curated_label")}
          </Badge>

          {brief ? (
            <div className="mt-4 space-y-5">
              {brief.commonFaults.length > 0 && (
                <div>
                  <h4 className="kg-label font-medium text-gray-600">{t("repair_common_faults")}</h4>
                  <ul className="mt-2 space-y-2.5">
                    {brief.commonFaults.map((fault) => (
                      <li key={fault.part} className="text-[13px] leading-relaxed text-gray-700">
                        <span className="font-semibold text-gray-900">{fault.part}</span> — {fault.symptom}
                        {fault.whoFixesIt && (
                          <span className="block text-gray-500">{fill(t("repair_who_fixes"), { who: fault.whoFixesIt })}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {brief.localTerms.length > 0 && (
                <div>
                  <h4 className="kg-label font-medium text-gray-600">{t("repair_local_terms")}</h4>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {brief.localTerms.map((term) => (
                      <li key={term}>
                        <Badge variant="outline">{term}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {brief.questionsToAsk.length > 0 && (
                <div>
                  <h4 className="kg-label font-medium text-gray-600">{t("repair_questions")}</h4>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-gray-700">
                    {brief.questionsToAsk.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                </div>
              )}

              {brief.typicalCostBand && (
                <div className="rounded-xl border border-gray-200 bg-card p-3.5">
                  <h4 className="kg-label font-medium text-gray-600">{t("repair_cost_band")}</h4>
                  <p className="mt-1 text-[15px] font-semibold text-gray-900">
                    ₹{brief.typicalCostBand.low.toLocaleString("en-IN")} – ₹
                    {brief.typicalCostBand.high.toLocaleString("en-IN")}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{brief.typicalCostBand.note}</p>
                  <p className="mt-1.5 text-[12px] font-medium text-[var(--color-maroon)]">{t("repair_cost_caveat")}</p>
                </div>
              )}
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.curated.map((entry) => (
                <li key={entry.slug} className="text-[13px] leading-relaxed text-gray-700">
                  <span className="font-semibold text-gray-900">{t(entry.partKey)}</span> — {t(entry.symptomKey)}
                  <span className="mt-0.5 flex items-start gap-1.5 text-gray-500">
                    <MessageSquarePlus size={13} className="mt-0.5 shrink-0" aria-hidden />
                    {t(entry.askKey)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-5 text-[12px] leading-relaxed text-gray-500">{t("repair_no_directory_note")}</p>
        </Card>
      </section>
    </div>
  );
}
