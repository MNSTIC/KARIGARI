"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Lock,
  ShieldCheck,
  Wand2,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { SchemeFormAssistant, type AssistantScheme } from "@/components/SchemeFormAssistant";

/**
 * The schemes page renders whatever the server-side eligibility engine
 * (`/api/artisan/schemes` → `src/lib/schemes.ts`) decided. It never re-computes
 * eligibility in the browser, and it never claims KARIGARI submitted anything
 * to a government system — applying records a tracker row and sends the artisan
 * to the official portal.
 */

type VerdictStatus = "ELIGIBLE" | "INELIGIBLE" | "INFO_NEEDED";

interface PublicRule {
  id: string;
  label: string;
  verifiable: boolean;
}

interface RuleFailure extends PublicRule {
  actual?: string;
  needed?: string;
  missingField?: string;
}

interface Verdict {
  status: VerdictStatus;
  failed: RuleFailure[];
  selfDeclare: PublicRule[];
  missing?: string[];
}

interface TrackedApplication {
  id: string;
  schemeName: string;
  status: "ELIGIBLE" | "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DISBURSED";
  appliedAt: string | null;
  notes: string | null;
  stale?: boolean;
}

interface EvaluatedScheme {
  key: string;
  name: string;
  description: string;
  benefit: string;
  officialUrl: string;
  applyMode: "DIRECT" | "DOWNLOAD_FORM";
  formPath?: string;
  note?: string;
  rules: PublicRule[];
  verdict: Verdict;
  application: TrackedApplication | null;
}

interface ProfileSummary {
  craftType: string | null;
  location: string | null;
  mobileNumber: string | null;
  socialCategory: string | null;
  annualIncome: number | null;
  aadhaarLast4: string | null;
  upiId: string | null;
  clusterName: string | null;
  cooperativeId: string | null;
  hasListedItem: boolean;
  hasVerifiedItem: boolean;
}

interface SchemesResponse {
  success: boolean;
  artisanName: string | null;
  profileSummary: ProfileSummary;
  schemes: EvaluatedScheme[];
}

/**
 * Tracker colours follow the states themselves: in-flight is orange, a positive
 * outcome green, money actually paid blue. The ramps are the muted ones
 * globals.css redefines, so this stays inside the KARIGARI palette.
 */
const STATUS_STYLES: Record<TrackedApplication["status"], string> = {
  ELIGIBLE: "bg-[var(--color-mint)] text-primary border-[var(--color-sage)]",
  APPLIED: "bg-orange-50 text-orange-700 border-orange-100",
  UNDER_REVIEW: "bg-orange-50 text-orange-700 border-orange-100",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-gray-100 text-gray-600 border-gray-200",
  DISBURSED: "bg-blue-50 text-blue-700 border-blue-200",
};

export default function SchemesPage() {
  const { t } = useLanguage();

  const [data, setData] = useState<SchemesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  /** Scheme awaiting the self-declaration modal. */
  const [applyTarget, setApplyTarget] = useState<EvaluatedScheme | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  /** Scheme whose auto-fill sheet is open. */
  const [assistantScheme, setAssistantScheme] = useState<AssistantScheme | null>(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/artisan/schemes", { cache: "no-store" });
      const json = await res.json();
      if (json?.success) setData(json);
      else setError(true);
    } catch (e) {
      console.error("Failed to load schemes:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the buyer page uses.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const { eligible, blocked } = useMemo(() => {
    const all = data?.schemes ?? [];
    return {
      eligible: all.filter((s) => s.verdict.status === "ELIGIBLE"),
      blocked: all.filter((s) => s.verdict.status !== "ELIGIBLE"),
    };
  }, [data]);

  const profile = data?.profileSummary ?? null;

  const openApply = (scheme: EvaluatedScheme) => {
    setApplyTarget(scheme);
    setApplyError(null);
    setTicked(Object.fromEntries(scheme.verdict.selfDeclare.map((r) => [r.id, false])));
  };

  const allTicked =
    applyTarget !== null &&
    applyTarget.verdict.selfDeclare.every((rule) => ticked[rule.id] === true);

  const submitApply = async () => {
    if (!applyTarget || !allTicked) return;
    setSubmitting(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/artisan/schemes/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemeKey: applyTarget.key, selfDeclarations: ticked }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setApplyError(json?.error || t("schemes_error"));
        return;
      }
      setApplyTarget(null);
      await load();
    } catch (e) {
      console.error("Scheme apply failed:", e);
      setApplyError(t("schemes_error"));
    } finally {
      setSubmitting(false);
    }
  };

  const toAssistantScheme = (scheme: EvaluatedScheme): AssistantScheme => ({
    key: scheme.key,
    name: scheme.name,
    benefit: scheme.benefit,
    officialUrl: scheme.officialUrl,
    formPath: scheme.formPath,
  });

  const renderCard = (scheme: EvaluatedScheme) => {
    const isEligible = scheme.verdict.status === "ELIGIBLE";
    const isOpen = expanded === scheme.key;
    const app = scheme.application;

    return (
      <div
        key={scheme.key}
        className={cn(
          "bg-card rounded-2xl border shadow-card p-5 sm:p-6",
          isEligible ? "border-[var(--color-sage)]" : "border-gray-100"
        )}
      >
        <div className="flex flex-col sm:flex-row gap-4 sm:items-start justify-between">
          <div className="flex gap-4 min-w-0">
            <div
              className={cn(
                "w-11 h-11 rounded-full flex items-center justify-center shrink-0 border",
                isEligible
                  ? "bg-[var(--color-mint)] border-[var(--color-sage)] text-primary"
                  : "bg-gray-50 border-gray-100 text-gray-400"
              )}
            >
              {isEligible ? <Award size={20} /> : <Lock size={18} />}
            </div>

            <div className="min-w-0">
              <h3 className="font-serif font-bold text-primary text-lg mb-1">{scheme.name}</h3>
              <p className="text-sm text-gray-500 mb-3 max-w-xl leading-relaxed">{scheme.description}</p>

              <div className="inline-flex bg-[var(--color-mint)] text-primary px-3 py-1 rounded-full text-xs font-bold border border-[var(--color-sage)]/50 mb-2">
                {t("schemes_benefit")}: {scheme.benefit}
              </div>

              {scheme.note && (
                <p className="text-xs text-gray-500 italic mt-1 max-w-xl">{scheme.note}</p>
              )}

              {/* Why this one is blocked — the auditable part of the engine */}
              {!isEligible && scheme.verdict.failed.length > 0 && (
                <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                    {scheme.verdict.status === "INFO_NEEDED"
                      ? t("schemes_info_needed")
                      : t("schemes_why_blocked")}
                  </p>
                  <ul className="space-y-1.5">
                    {scheme.verdict.failed.map((rule) => (
                      <li key={rule.id} className="text-xs text-gray-600 leading-relaxed">
                        <span className="font-bold text-gray-800">{rule.label}</span>
                        {(rule.needed || rule.actual) && (
                          <span className="block text-gray-500">
                            {rule.needed && (
                              <>
                                {t("schemes_needs")}: {rule.needed}
                              </>
                            )}
                            {rule.needed && rule.actual ? " · " : ""}
                            {rule.actual && (
                              <>
                                {t("schemes_yours")}: {rule.actual}
                              </>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {scheme.verdict.status === "INFO_NEEDED" && (
                    <Link
                      href="/artisan/dashboard"
                      className="inline-block mt-3 text-xs font-bold text-primary underline underline-offset-2"
                    >
                      {t("schemes_complete_profile")}
                    </Link>
                  )}
                </div>
              )}

              {/* Tracker row — the app's own record, never a government outcome */}
              {app && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border",
                      STATUS_STYLES[app.status]
                    )}
                  >
                    <CheckCircle2 size={13} />
                    {t(`schemes_status_${app.status}`)}
                  </span>
                  {app.appliedAt && (
                    <span className="text-xs text-gray-400">
                      {new Date(app.appliedAt).toLocaleDateString("en-IN")}
                    </span>
                  )}
                </div>
              )}

              {/* Criteria — every rule, and how it was decided */}
              <button
                onClick={() => setExpanded(isOpen ? null : scheme.key)}
                className="mt-3 flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-primary transition-colors"
              >
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {isOpen ? t("schemes_hide_criteria") : t("schemes_show_criteria")}
              </button>

              {isOpen && (
                <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                  {scheme.rules.map((rule) => (
                    <li key={rule.id} className="text-xs text-gray-600 flex gap-2">
                      <span className="text-[var(--color-sage)] shrink-0">•</span>
                      <span>
                        {rule.label}
                        <span className="block text-[11px] text-gray-400">
                          {rule.verifiable
                            ? t("schemes_verified_from_profile")
                            : t("schemes_self_declared")}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 mt-2 sm:mt-0 sm:min-w-[190px] shrink-0">
            <button
              onClick={() => setAssistantScheme(toAssistantScheme(scheme))}
              className="bg-primary hover:bg-primary-dark text-white w-full py-3 rounded-xl font-bold shadow-sm transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Wand2 size={16} /> {t("scheme_assistant_title")}
            </button>

            {isEligible && !app && (
              <button
                onClick={() => openApply(scheme)}
                className="bg-white border border-[var(--color-sage)] text-primary hover:bg-[var(--color-mint)] w-full py-2.5 rounded-xl font-bold transition-colors text-sm flex items-center justify-center gap-2"
              >
                <ShieldCheck size={15} /> {t("schemes_track")}
              </button>
            )}

            <a
              href={scheme.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-xs font-bold text-gray-500 hover:text-primary transition-colors flex items-center justify-center gap-1.5 py-1"
            >
              <ExternalLink size={12} />
              {scheme.applyMode === "DOWNLOAD_FORM"
                ? t("schemes_download_form")
                : t("schemes_direct_apply")}
            </a>
            <p className="text-[10px] text-gray-400 text-center leading-tight">
              {t("schemes_opens_portal")}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-16">
      <header className="px-4 sm:px-8 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 flex items-center gap-4">
        <Link
          href="/artisan/dashboard"
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-600" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-serif font-bold text-primary truncate">{t("schemes_title")}</h1>
          <p className="text-xs text-gray-500 font-medium truncate">{t("schemes_page_subtitle")}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-8 space-y-8">
        {loading ? (
          <p className="text-center text-gray-500 py-20">{t("schemes_loading")}</p>
        ) : error || !data ? (
          <div className="text-center py-20">
            <p className="text-gray-500 mb-4">{t("schemes_error")}</p>
            <button
              onClick={load}
              className="bg-primary text-white px-6 py-2.5 rounded-xl font-bold hover:bg-primary-dark transition-colors"
            >
              {t("schemes_retry")}
            </button>
          </div>
        ) : (
          <>
            {/* Eligibility profile — what the engine actually read */}
            <section className="bg-card rounded-2xl border border-gray-100 shadow-card p-5 sm:p-6">
              <h2 className="font-serif font-bold text-primary text-lg mb-4">
                {t("schemes_profile_title")}
              </h2>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: t("schemes_profile_craft"), value: profile?.craftType },
                  { label: t("schemes_profile_cluster"), value: profile?.clusterName || profile?.location },
                  { label: t("schemes_profile_category"), value: profile?.socialCategory },
                  {
                    label: t("schemes_profile_income"),
                    value:
                      profile?.annualIncome || profile?.annualIncome === 0
                        ? `₹${profile.annualIncome.toLocaleString("en-IN")}`
                        : null,
                  },
                  {
                    label: t("schemes_profile_aadhaar"),
                    value: profile?.aadhaarLast4 ? `•••• ${profile.aadhaarLast4}` : null,
                  },
                ].map((row) => (
                  <div key={row.label}>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">
                      {row.label}
                    </dt>
                    <dd
                      className={cn(
                        "text-sm font-bold",
                        row.value ? "text-primary" : "text-gray-400 italic font-medium"
                      )}
                    >
                      {row.value || t("schemes_not_set")}
                    </dd>
                  </div>
                ))}
              </dl>

              {!profile?.socialCategory && (
                <Link
                  href="/artisan/dashboard"
                  className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-primary bg-[var(--color-mint)] px-3 py-2 rounded-lg hover:bg-[var(--color-sage)]/40 transition-colors"
                >
                  {t("schemes_category_prompt")}
                </Link>
              )}
            </section>

            {/* Eligible */}
            <section>
              <h2 className="font-serif font-bold text-primary text-lg mb-1">
                {t("schemes_eligible_heading")} ({eligible.length})
              </h2>
              <p className="text-sm text-gray-500 mb-4">{t("schemes_eligible_sub")}</p>
              {eligible.length === 0 ? (
                <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-6 text-center">
                  {t("schemes_none_eligible")}
                </p>
              ) : (
                <div className="space-y-4">{eligible.map(renderCard)}</div>
              )}
            </section>

            {/* Blocked */}
            <section>
              <h2 className="font-serif font-bold text-primary text-lg mb-1">
                {t("schemes_not_eligible_heading")} ({blocked.length})
              </h2>
              <p className="text-sm text-gray-500 mb-4">{t("schemes_not_eligible_sub")}</p>
              {blocked.length === 0 ? (
                <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-6 text-center">
                  {t("schemes_none_blocked")}
                </p>
              ) : (
                <div className="space-y-4">{blocked.map(renderCard)}</div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Self-declaration modal — the only thing "apply" does is record a row */}
      {applyTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setApplyTarget(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
              aria-label={t("schemes_modal_cancel")}
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-serif font-bold text-primary mb-1 pr-8">
              {t("schemes_modal_title")}
            </h3>
            <p className="text-sm font-bold text-gray-600 mb-3">{applyTarget.name}</p>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">{t("schemes_modal_intro")}</p>

            <div className="space-y-3 mb-5">
              {applyTarget.verdict.selfDeclare.map((rule) => (
                <label
                  key={rule.id}
                  className="flex gap-3 items-start bg-[var(--color-background)] border border-gray-100 rounded-xl p-3 cursor-pointer hover:border-[var(--color-sage)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={ticked[rule.id] || false}
                    onChange={(e) => setTicked((prev) => ({ ...prev, [rule.id]: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 accent-[var(--color-primary)] shrink-0"
                  />
                  <span className="text-sm text-gray-700 leading-relaxed">{rule.label}</span>
                </label>
              ))}
            </div>

            <p className="text-xs text-gray-500 bg-[var(--color-mint)]/50 border border-[var(--color-sage)]/40 rounded-xl p-3 mb-5 leading-relaxed">
              {t("schemes_modal_honesty")}
            </p>

            {applyError && (
              <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
                {applyError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setApplyTarget(null)}
                className="flex-1 py-3 rounded-xl font-bold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {t("schemes_modal_cancel")}
              </button>
              <button
                onClick={submitApply}
                disabled={!allTicked || submitting}
                className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting
                  ? t("schemes_tracking")
                  : allTicked
                    ? t("schemes_modal_confirm")
                    : t("schemes_modal_tick_all")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-fill assistant */}
      <SchemeFormAssistant
        scheme={assistantScheme}
        profile={
          data
            ? {
                name: data.artisanName,
                craftType: profile?.craftType,
                location: profile?.location,
                mobileNumber: profile?.mobileNumber,
                socialCategory: profile?.socialCategory,
                annualIncome: profile?.annualIncome,
                aadhaarLast4: profile?.aadhaarLast4,
                upiId: profile?.upiId,
                clusterName: profile?.clusterName,
                cooperativeId: profile?.cooperativeId,
              }
            : null
        }
        onClose={() => setAssistantScheme(null)}
      />
    </div>
  );
}
