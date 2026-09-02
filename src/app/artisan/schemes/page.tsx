"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  ExternalLink,
  Globe2,
  Landmark,
  Lock,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { SchemeFormAssistant, type AssistantScheme } from "@/components/SchemeFormAssistant";
import { Shell } from "@/components/ui/AppShell";
import { Card } from "@/components/ui/Card";
import { DarkCard, PinkButton } from "@/components/ui/DarkCard";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/FilterTabs";
import { PageLede, PageTitle, SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import { ProgressBar } from "@/components/ui/ProgressBar";

/**
 * The schemes page renders whatever the server-side eligibility engine
 * (`/api/artisan/schemes` → `src/lib/schemes.ts`) decided. It never re-computes
 * eligibility in the browser, and it never claims KARIGARI submitted anything
 * to a government system — applying records a tracker row and sends the artisan
 * to the official portal.
 */

type VerdictStatus = "ELIGIBLE" | "INELIGIBLE" | "INFO_NEEDED";

type Translate = (key: string) => string;

/**
 * A localised string with the server's English as the fallback.
 *
 * The eligibility engine is server-side and language-agnostic on purpose — it
 * returns published criteria as English strings, and none of them ever passed
 * through `t()`, which is why switching the globe left every scheme name and
 * description in English. Only the *presentation* is localised here: nothing
 * about which schemes an artisan qualifies for is decided in the browser.
 *
 * `t` returns the key itself when a dictionary has no entry, so that is the
 * signal to fall back to whatever the server sent — a scheme seeded with a key
 * we have not translated yet reads in English rather than blanking out.
 */
function localized(t: Translate, key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

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

const STATUS_STYLES: Record<TrackedApplication["status"], string> = {
  ELIGIBLE: "bg-[var(--color-pill)] text-gray-800 border-transparent",
  APPLIED: "bg-orange-50 text-orange-700 border-orange-100",
  UNDER_REVIEW: "bg-orange-50 text-orange-700 border-orange-100",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-gray-100 text-gray-600 border-gray-200",
  DISBURSED: "bg-blue-50 text-blue-700 border-blue-200",
};

/**
 * How far along the tracker each status is, as a percentage.
 *
 * Karigari's own record only — the progress bar describes where the artisan is
 * in *this* app's tracker, not what any government portal has decided.
 */
const TRACKER_PROGRESS: Record<TrackedApplication["status"], number> = {
  ELIGIBLE: 15,
  APPLIED: 40,
  UNDER_REVIEW: 65,
  APPROVED: 85,
  DISBURSED: 100,
  REJECTED: 100,
};

/**
 * The plate mark on each scheme card.
 *
 * Karigari stores no imagery against a scheme, so rather than borrowing an
 * unrelated craft photo and implying it depicts the programme, each card gets a
 * large, low-contrast glyph for the kind of body that runs it.
 */
const SCHEME_MARK: Record<string, React.ReactNode> = {
  pm_vishwakarma: <Landmark size={104} strokeWidth={0.6} />,
  ahvy: <Landmark size={104} strokeWidth={0.6} />,
  nsfdc: <Banknote size={104} strokeWidth={0.6} />,
  nbcfdc: <Banknote size={104} strokeWidth={0.6} />,
  gem_seller: <Store size={104} strokeWidth={0.6} />,
  ondc: <Globe2 size={104} strokeWidth={0.6} />,
};

/**
 * The tracked eyebrow above each scheme title, derived from the scheme key.
 *
 * The map holds i18n keys rather than English, so the eyebrow switches with the
 * globe like everything else on the card. An unknown key falls through to the
 * generic label instead of rendering a raw key.
 */
const SCHEME_TYPE_KEY: Record<string, string> = {
  pm_vishwakarma: "scheme_type_pm_vishwakarma",
  ahvy: "scheme_type_ahvy",
  nsfdc: "scheme_type_nsfdc",
  nbcfdc: "scheme_type_nbcfdc",
  gem_seller: "scheme_type_gem_seller",
  ondc: "scheme_type_ondc",
};

/**
 * The headline figure on a scheme card, lifted out of its published benefit
 * string. No amount is invented: a scheme whose benefit is not monetary gets
 * the neutral label instead of a fabricated grant.
 */
function grantBadge(benefit: string, t: Translate): string {
  const match = benefit.match(/₹\s?[\d,]+(?:\s?lakh|\s?crore)?/i);
  return match
    ? t("schemes_benefit_suffix").replace("{amount}", match[0].replace(/\s+/g, " ").trim())
    : t("schemes_support_programme");
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

  const toAssistantScheme = (scheme: EvaluatedScheme): AssistantScheme => ({
    key: scheme.key,
    name: scheme.name,
    // The sheet SHOWS the localised name but WRITES the English one into the
    // downloadable draft: the form is submitted to a government portal that
    // knows the scheme by its official English title.
    displayName: localized(t, `scheme_${scheme.key}_name`, scheme.name),
    benefit: scheme.benefit,
    officialUrl: scheme.officialUrl,
    formPath: scheme.formPath,
  });

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
                    onAssist={() => setAssistantScheme(toAssistantScheme(scheme))}
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
                    onAssist={() => setAssistantScheme(toAssistantScheme(scheme))}
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

/**
 * One eligible scheme.
 *
 * The reference puts a photograph in the left panel. Karigari stores no imagery
 * against a scheme, so rather than borrowing an unrelated craft photo and
 * implying it depicts the programme, the panel is a typographic plate carrying
 * the benefit the scheme actually publishes.
 */
function SchemeCard({
  scheme,
  expanded,
  onToggle,
  onApply,
  onAssist,
  t,
}: {
  scheme: EvaluatedScheme;
  expanded: boolean;
  onToggle: () => void;
  onApply: () => void;
  onAssist: () => void;
  t: (key: string) => string;
}) {
  const app = scheme.application;

  return (
    <article className="kg-lift overflow-hidden rounded-2xl border-l-[3px] border-l-[var(--color-rust)] bg-card shadow-card">
      <div className="grid sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
        <div className="relative flex min-h-[150px] flex-col justify-between overflow-hidden bg-[var(--color-gray-100)] p-5">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-6 text-gray-300/70"
          >
            {SCHEME_MARK[scheme.key] ?? <Landmark size={104} strokeWidth={0.6} />}
          </span>
          <SectionEyebrow className="relative">
            {scheme.applyMode === "DIRECT" ? t("schemes_apply_online") : t("schemes_form_based")}
          </SectionEyebrow>
          <span className="kg-label relative inline-flex w-fit items-center rounded-lg bg-primary px-2.5 py-1.5 font-medium text-white">
            {grantBadge(localized(t, `scheme_${scheme.key}_benefit`, scheme.benefit), t)}
          </span>
        </div>

        <div className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionEyebrow>
              {t(SCHEME_TYPE_KEY[scheme.key] ?? "scheme_type_generic")}
            </SectionEyebrow>
            <Badge variant="outline" className="shrink-0">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-rust)]" />
              {scheme.applyMode === "DIRECT"
                ? t("schemes_direct_benefit")
                : t("schemes_form_download")}
            </Badge>
          </div>

          <h3 className="kg-display mt-2 text-[22px] leading-snug text-gray-900">
            {localized(t, `scheme_${scheme.key}_name`, scheme.name)}
          </h3>
          <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-gray-600">
            {localized(t, `scheme_${scheme.key}_desc`, scheme.description)}
          </p>

          {scheme.note && (
            <p className="mt-2.5 text-[12px] leading-relaxed text-gray-500">
              {localized(t, `scheme_${scheme.key}_note`, scheme.note)}
            </p>
          )}

          {/* Tracker row — the app's own record, never a government outcome */}
          {app && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                  STATUS_STYLES[app.status]
                )}
              >
                {t(`schemes_status_${app.status}`)}
              </span>
              {app.appliedAt && (
                <span className="kg-label text-gray-400">
                  {new Date(app.appliedAt).toLocaleDateString("en-IN")}
                </span>
              )}
              <ProgressBar
                value={TRACKER_PROGRESS[app.status] ?? 0}
                label={app.schemeName}
                size="sm"
                tone={app.status === "REJECTED" ? "danger" : "primary"}
                className="mt-1 w-full"
              />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-gray-200/70 pt-4">
            <button
              onClick={onToggle}
              className="kg-press inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-gray-900"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? t("schemes_hide_criteria") : t("schemes_show_criteria")}
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-2.5">
              {!app && (
                <button
                  onClick={onApply}
                  className="kg-press inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-[12px] font-semibold text-gray-800 hover:bg-gray-50"
                >
                  <ShieldCheck size={14} /> {t("schemes_track")}
                </button>
              )}
              <button
                onClick={onAssist}
                className="kg-press kg-label inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-primary px-4 font-medium text-white hover:bg-primary-dark"
              >
                <Sparkles size={14} /> {t("schemes_autofill_apply")}
              </button>
            </div>
          </div>

          {expanded && (
            <ul className="mt-4 space-y-2.5 border-t border-gray-200/70 pt-4">
              {scheme.rules.map((rule) => (
                <li key={rule.id} className="flex gap-2.5 text-xs text-gray-600">
                  <span aria-hidden className="shrink-0 text-gray-300">
                    •
                  </span>
                  <span>
                    {localized(t, `scheme_rule_${rule.id}`, rule.label)}
                    <span className="kg-label mt-0.5 block text-gray-400">
                      {rule.verifiable
                        ? t("schemes_verified_from_profile")
                        : t("schemes_self_declared")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <a
            href={scheme.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-gray-900"
          >
            <ExternalLink size={12} />
            {scheme.applyMode === "DOWNLOAD_FORM"
              ? t("schemes_download_form")
              : t("schemes_direct_apply")}
            <span className="font-normal text-gray-400">· {t("schemes_opens_portal")}</span>
          </a>
        </div>
      </div>
    </article>
  );
}

/** A scheme the artisan does not yet qualify for, and exactly why. */
function LockedCard({
  scheme,
  onAssist,
  t,
}: {
  scheme: EvaluatedScheme;
  onAssist: () => void;
  t: (key: string) => string;
}) {
  const reason = scheme.verdict.failed[0];
  const needsInfo = scheme.verdict.status === "INFO_NEEDED";

  return (
    <article className="rounded-2xl bg-[var(--color-gray-100)] p-5">
      <h3 className="kg-display text-[18px] leading-snug text-gray-900">
        {localized(t, `scheme_${scheme.key}_name`, scheme.name)}
      </h3>

      {reason ? (
        <div className="mt-3 rounded-xl bg-white/70 p-3.5">
          <p className="kg-label flex items-center gap-1.5 font-medium text-[var(--color-maroon)]">
            <CircleSlash size={12} className="shrink-0" />
            {needsInfo ? t("schemes_info_needed") : t("schemes_why_blocked")}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
            {localized(t, `scheme_rule_${reason.id}`, reason.label)}
            {(reason.needed || reason.actual) && (
              <span className="mt-1 block text-gray-500">
                {reason.needed &&
                  `${t("schemes_needs")}: ${localized(t, `scheme_needs_${reason.id}`, reason.needed)}`}
                {reason.needed && reason.actual ? " · " : ""}
                {reason.actual && `${t("schemes_yours")}: ${reason.actual}`}
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-gray-500">
          {localized(t, `scheme_${scheme.key}_desc`, scheme.description)}
        </p>
      )}

      {needsInfo ? (
        <Link
          href="/artisan/dashboard?edit=profile"
          className="kg-label mt-4 inline-flex items-center gap-1.5 font-medium text-gray-700 hover:text-gray-900"
        >
          {t("schemes_complete_profile")} <ArrowRight size={12} />
        </Link>
      ) : (
        <button
          onClick={onAssist}
          className="kg-label mt-4 inline-flex items-center gap-1.5 font-medium text-gray-700 hover:text-gray-900"
        >
          {t("schemes_see_requirements")} <ArrowRight size={12} />
        </button>
      )}
    </article>
  );
}
