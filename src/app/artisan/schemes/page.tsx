"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CircleSlash,
  Lock,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { SchemeFormAssistant, type AssistantScheme } from "@/components/SchemeFormAssistant";
import { Shell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { DarkCard, PinkButton } from "@/components/ui/DarkCard";
import { Pill } from "@/components/ui/FilterTabs";
import { PageLede, PageTitle, SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import {
  LockedCard,
  SchemeCard,
  toAssistantScheme,
  localized,
  type EvaluatedScheme,
  type Translate,
} from "@/components/schemes/SchemeCard";

/**
 * The schemes page renders whatever the server-side eligibility engine
 * (`/api/artisan/schemes` → `src/lib/schemes.ts`) decided. It never re-computes
 * eligibility in the browser, and it never claims KARIGARI submitted anything
 * to a government system — applying records a tracker row and sends the artisan
 * to the official portal.
 */


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
 * Profile completeness, from the fields the eligibility engine actually reads.
 *
 * Every entry here is a real column on `ArtisanProfile`, so the percentage says
 * something true: filling the missing ones is what unlocks more schemes.
 */
function profileCompletion(profile: ProfileSummary | null, t: Translate) {
  const fields = [
    { key: "craftType", label: t("schemes_field_craft_type"), filled: Boolean(profile?.craftType) },
    { key: "location", label: t("schemes_field_location"), filled: Boolean(profile?.location || profile?.clusterName) },
    { key: "mobileNumber", label: t("schemes_field_mobile"), filled: Boolean(profile?.mobileNumber) },
    { key: "socialCategory", label: t("schemes_field_social_category"), filled: Boolean(profile?.socialCategory) },
    {
      key: "annualIncome",
      label: t("schemes_field_annual_income"),
      filled: profile?.annualIncome !== null && profile?.annualIncome !== undefined,
    },
    { key: "aadhaarLast4", label: t("schemes_field_aadhaar"), filled: Boolean(profile?.aadhaarLast4) },
    { key: "upiId", label: t("schemes_field_bank_upi"), filled: Boolean(profile?.upiId) },
  ];
  const filled = fields.filter((f) => f.filled).length;
  return {
    fields,
    pct: Math.round((filled / fields.length) * 100),
    missing: fields.filter((f) => !f.filled),
  };
}

export default function SchemesPage() {
  const { t } = useLanguage();

  const [data, setData] = useState<SchemesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Hide schemes the artisan has already started tracking. */
  const [hideTracked, setHideTracked] = useState(false);

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
  const completion = useMemo(() => profileCompletion(profile, t), [profile, t]);

  const shownEligible = hideTracked ? eligible.filter((s) => !s.application) : eligible;

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

  // One converter, shared with the workshop's funding tab.
  const openAssistant = (scheme: EvaluatedScheme): AssistantScheme => toAssistantScheme(scheme, t);

  return (
    <Shell>
      <PageTitle>{t("page_schemes_title")}</PageTitle>
      <PageLede>{t("schemes_page_subtitle")}</PageLede>

      {/* ================================================ Eligibility card */}
      <DarkCard arc className="kg-enter mt-9">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <SectionEyebrow tone="light">{t("schemes_eligibility_profile")}</SectionEyebrow>

            <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="kg-display text-[52px] leading-none text-white">
                {loading ? "—" : `${completion.pct}%`}
              </span>
              <span className="kg-display text-[24px] leading-none text-white/90">
                {t("schemes_profile_complete_label")}
              </span>
            </div>

            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/60">
              {t(eligible.length === 1 ? "schemes_unlocks_one" : "schemes_unlocks_many").replace(
                "{n}",
                String(eligible.length)
              )}{" "}
              {completion.missing.length > 0
                ? t("schemes_add_to_be_checked").replace(
                    "{fields}",
                    completion.missing
                      .slice(0, 2)
                      .map((f) => f.label.toLowerCase())
                      .join(", ")
                  )
                : t("schemes_all_fields_filled")}
            </p>

            <ul className="mt-6 flex flex-wrap gap-2.5">
              {completion.fields.map((field) => (
                <li key={field.key}>
                  <Pill tone={field.filled ? "onDark" : "onDarkMuted"} className="kg-label font-medium">
                    {field.filled ? (
                      <ShieldCheck size={13} className="shrink-0" />
                    ) : (
                      <CircleSlash size={13} className="shrink-0" />
                    )}
                    {field.label}
                  </Pill>
                </li>
              ))}
            </ul>
          </div>

          <div className="shrink-0">
            <PinkButton href="/artisan/dashboard?edit=profile" className="w-full lg:w-auto">
              {t("schemes_update_profile")} <ArrowRight size={15} />
            </PinkButton>
          </div>
        </div>
      </DarkCard>

      {loading ? (
        <div className="mt-14 space-y-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="kg-shimmer h-44 rounded-2xl" />
          ))}
        </div>
      ) : error || !data ? (
        <Card pad="lg" className="mt-14 border-dashed text-center">
          <p className="mb-5 text-gray-500">{t("schemes_error")}</p>
          <button
            onClick={load}
            className="kg-press inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-[13px] font-semibold text-white hover:bg-primary-dark"
          >
            {t("schemes_retry")}
          </button>
        </Card>
      ) : (
        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ------------------------------------------------- Eligible */}
          <section aria-labelledby="eligible-heading" className="min-w-0">
            <SectionHeading
              id="eligible-heading"
              action={
                <Pill
                  icon={<SlidersHorizontal size={14} />}
                  tone={hideTracked ? "dark" : "neutral"}
                  onClick={() => setHideTracked((v) => !v)}
                >
                  {hideTracked ? t("schemes_showing_new_only") : t("schemes_filter")}
                </Pill>
              }
            >
              {t("schemes_eligible_for_you")}{" "}
              <span className="kg-label ml-1 inline-flex h-6 w-6 translate-y-[-3px] items-center justify-center rounded-full bg-primary font-medium text-white">
                {eligible.length}
              </span>
            </SectionHeading>

            {shownEligible.length === 0 ? (
              <Card pad="lg" className="border-dashed text-center text-[14px] text-gray-500">
                {eligible.length === 0
                  ? t("schemes_none_eligible")
                  : t("schemes_all_started")}
              </Card>
            ) : (
              <div className="kg-stagger space-y-5">
                {shownEligible.map((scheme) => (
                  <SchemeCard
                    key={scheme.key}
                    scheme={scheme}
                    expanded={expanded === scheme.key}
                    onToggle={() => setExpanded(expanded === scheme.key ? null : scheme.key)}
                    onApply={() => openApply(scheme)}
                    onAssist={() => setAssistantScheme(openAssistant(scheme))}
                    t={t}
                  />
                ))}
              </div>
            )}
          </section>

          {/* --------------------------------------------------- Locked */}
          <aside aria-labelledby="locked-heading" className="min-w-0">
            <SectionHeading id="locked-heading" size="sm">
              <span className="inline-flex items-center gap-2.5">
                <Lock size={18} strokeWidth={1.7} className="text-gray-500" />
                {t("schemes_locked_heading")}
              </span>
            </SectionHeading>

            {blocked.length === 0 ? (
              <Card tone="muted" className="text-[13px] text-gray-500">
                {t("schemes_none_blocked")}
              </Card>
            ) : (
              <div className="space-y-4">
                {blocked.map((scheme) => (
                  <LockedCard
                    key={scheme.key}
                    scheme={scheme}
                    onAssist={() => setAssistantScheme(openAssistant(scheme))}
                    t={t}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Self-declaration modal — the only thing "apply" does is record a row */}
      {applyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-6 shadow-2xl">
            <button
              onClick={() => setApplyTarget(null)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-700"
              aria-label={t("schemes_modal_cancel")}
            >
              <X size={20} />
            </button>

            <h3 className="kg-display mb-1 pr-8 text-[22px] text-gray-900">
              {t("schemes_modal_title")}
            </h3>
            <p className="mb-3 text-sm font-semibold text-gray-700">
              {localized(t, `scheme_${applyTarget.key}_name`, applyTarget.name)}
            </p>
            <p className="mb-5 text-sm leading-relaxed text-gray-500">{t("schemes_modal_intro")}</p>

            <div className="mb-5 space-y-3">
              {applyTarget.verdict.selfDeclare.map((rule) => (
                <label
                  key={rule.id}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-[var(--color-background)] p-3 transition-colors hover:border-gray-400"
                >
                  <input
                    type="checkbox"
                    checked={ticked[rule.id] || false}
                    onChange={(e) => setTicked((prev) => ({ ...prev, [rule.id]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                  />
                  <span className="text-sm leading-relaxed text-gray-700">
                    {localized(t, `scheme_rule_${rule.id}`, rule.label)}
                  </span>
                </label>
              ))}
            </div>

            <p className="mb-5 rounded-xl bg-[var(--color-pill)] p-3 text-xs leading-relaxed text-gray-600">
              {t("schemes_modal_honesty")}
            </p>

            {applyError && (
              <p className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
                {applyError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setApplyTarget(null)}
                className="kg-press min-h-[48px] flex-1 rounded-xl border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50"
              >
                {t("schemes_modal_cancel")}
              </button>
              <button
                onClick={submitApply}
                disabled={!allTicked || submitting}
                className="kg-press min-h-[48px] flex-1 rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
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
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */


/** A scheme the artisan does not yet qualify for, and exactly why. */
