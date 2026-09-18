"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck, ExternalLink, Landmark } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionEyebrow";
import { SchemeFormAssistant, type AssistantScheme } from "@/components/SchemeFormAssistant";
import {
  LockedCard,
  SchemeCard,
  toAssistantScheme,
  type EvaluatedScheme,
  type ProfileSummaryFields,
} from "@/components/schemes/SchemeCard";
import { fill, passportDay } from "@/components/buyer/passportFormat";

/**
 * Equipment funding.
 *
 * The same cards as /artisan/schemes, filtered to the schemes whose purpose is
 * buying or repairing equipment — imported, not re-implemented, so the two
 * screens cannot drift apart. Eligibility is decided server-side; when a scheme
 * is out of reach the card says which rule blocks it.
 *
 * Under each card: the official page its figures were read from and the date
 * they were checked. A scheme whose figures could not be confirmed never
 * reaches this list at all (src/lib/schemes.ts withholds it), and the footnote
 * says when that has happened rather than showing a shorter list silently.
 */

interface SchemesResponse {
  success: boolean;
  profileSummary: ProfileSummaryFields;
  schemes: EvaluatedScheme[];
  /** Schemes held back because their source could not be confirmed. */
  withheld?: { key: string; name: string }[];
}

export function FundingSection() {
  const { t } = useLanguage();
  const [data, setData] = useState<SchemesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assistantScheme, setAssistantScheme] = useState<AssistantScheme | null>(null);

  useEffect(() => {
    let cancelled = false;
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch("/api/artisan/schemes", { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok || !payload?.success) throw new Error(`schemes ${res.status}`);
        if (!cancelled) setData(payload as SchemesResponse);
      } catch (error) {
        console.warn("[workshop] schemes unavailable:", (error as Error)?.message);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="kg-shimmer h-[180px] rounded-2xl" />
        <div className="kg-shimmer h-[180px] rounded-2xl" />
      </div>
    );
  }

  if (failed || !data) {
    return (
      <Card pad="lg" className="border-dashed text-center">
        <AlertTriangle size={24} className="mx-auto mb-3 text-gray-400" />
        <p className="text-[14px] text-gray-600">{t("funding_load_failed")}</p>
      </Card>
    );
  }

  const equipment = data.schemes.filter((scheme) => scheme.equipmentFunding);
  const open = equipment.filter((scheme) => scheme.verdict.status === "ELIGIBLE");
  const blocked = equipment.filter((scheme) => scheme.verdict.status !== "ELIGIBLE");

  const citation = (scheme: EvaluatedScheme) =>
    scheme.sourceUrl && scheme.verifiedOn ? (
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-relaxed text-gray-500">
        <a
          href={scheme.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-gray-900 [overflow-wrap:anywhere]"
        >
          <ExternalLink size={12} aria-hidden /> {t("funding_source")}
        </a>
        <span className="inline-flex items-center gap-1">
          <CalendarCheck size={12} aria-hidden /> {fill(t("funding_checked_on"), { date: passportDay(scheme.verifiedOn) })}
        </span>
      </p>
    ) : null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="funding-open">
        <SectionHeading id="funding-open" size="sm">
          <span className="inline-flex items-center gap-2">
            <Landmark size={18} className="text-gray-500" aria-hidden /> {t("funding_title")}
          </span>
        </SectionHeading>
        <p className="-mt-1 mb-5 max-w-2xl text-[14px] leading-relaxed text-gray-600">{t("funding_lede")}</p>

        {open.length === 0 ? (
          <Card pad="lg" className="border-dashed text-center text-[14px] text-gray-600">
            {t("funding_none_eligible")}
          </Card>
        ) : (
          <div className="kg-stagger space-y-5">
            {open.map((scheme) => (
              <div key={scheme.key}>
                <SchemeCard
                  scheme={scheme}
                  expanded={expanded === scheme.key}
                  onToggle={() => setExpanded(expanded === scheme.key ? null : scheme.key)}
                  onApply={() => window.open(scheme.formPath || scheme.officialUrl, "_blank", "noopener,noreferrer")}
                  onAssist={() => setAssistantScheme(toAssistantScheme(scheme, t))}
                  t={t}
                />
                {citation(scheme)}
              </div>
            ))}
          </div>
        )}
      </section>

      {blocked.length > 0 && (
        <section aria-labelledby="funding-blocked">
          <SectionHeading id="funding-blocked" size="sm">
            {t("funding_blocked_title")}
          </SectionHeading>
          <div className="space-y-4">
            {blocked.map((scheme) => (
              <div key={scheme.key}>
                <LockedCard
                  scheme={scheme}
                  onAssist={() => setAssistantScheme(toAssistantScheme(scheme, t))}
                  t={t}
                />
                {citation(scheme)}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.withheld && data.withheld.length > 0 && (
        <p className="text-[12px] leading-relaxed text-gray-500">
          {fill(t("funding_withheld"), { n: data.withheld.length })}
        </p>
      )}

      <SchemeFormAssistant
        scheme={assistantScheme}
        profile={
          data.profileSummary
            ? {
                craftType: data.profileSummary.craftType,
                location: data.profileSummary.location,
                socialCategory: data.profileSummary.socialCategory,
                annualIncome: data.profileSummary.annualIncome,
                aadhaarLast4: data.profileSummary.aadhaarLast4,
                upiId: data.profileSummary.upiId,
                clusterName: data.profileSummary.clusterName,
                cooperativeId: data.profileSummary.cooperativeId,
              }
            : null
        }
        onClose={() => setAssistantScheme(null)}
      />
    </div>
  );
}
