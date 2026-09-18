"use client";

import React from "react";
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
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/utils";

/**
 * One government scheme, as a card — and the payload types the eligibility API
 * answers with.
 *
 * Lifted out of /artisan/schemes so the Workshop Resources funding tab shows the
 * same card instead of a second rendering that could drift from it. Eligibility
 * is still decided server-side in src/lib/schemes.ts; nothing here recomputes
 * who qualifies for what.
 */

export const STATUS_STYLES: Record<TrackedApplication["status"], string> = {
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
export const TRACKER_PROGRESS: Record<TrackedApplication["status"], number> = {
  ELIGIBLE: 15,
  APPLIED: 40,
  UNDER_REVIEW: 65,
  APPROVED: 85,
  DISBURSED: 100,
  REJECTED: 100,
};

/** The profile fields the eligibility engine reads, as the API returns them. */
export interface ProfileSummaryFields {
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

export type VerdictStatus = "ELIGIBLE" | "INELIGIBLE" | "INFO_NEEDED";

export type Translate = (key: string) => string;

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
export function localized(t: Translate, key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

export interface PublicRule {
  id: string;
  label: string;
  verifiable: boolean;
}

export interface RuleFailure extends PublicRule {
  actual?: string;
  needed?: string;
  missingField?: string;
}

export interface Verdict {
  status: VerdictStatus;
  failed: RuleFailure[];
  selfDeclare: PublicRule[];
  missing?: string[];
}

export interface TrackedApplication {
  id: string;
  schemeName: string;
  status: "ELIGIBLE" | "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DISBURSED";
  appliedAt: string | null;
  notes: string | null;
  stale?: boolean;
}

export interface EvaluatedScheme {
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
  /** True when the scheme's purpose is buying or repairing equipment. */
  equipmentFunding?: boolean;
  /** The official page the figures were read from. */
  sourceUrl?: string;
  /** ISO date those figures were last checked. */
  verifiedOn?: string | null;
}

/**
 * The shape the form assistant takes.
 *
 * One converter, used by the schemes page and by the workshop's funding tab:
 * the sheet SHOWS the localised name but WRITES the English one into the
 * downloadable draft, because the portal receiving it knows the scheme by its
 * official English title and by no other.
 */
export function toAssistantScheme(scheme: EvaluatedScheme, t: Translate) {
  return {
    key: scheme.key,
    name: scheme.name,
    displayName: localized(t, `scheme_${scheme.key}_name`, scheme.name),
    benefit: scheme.benefit,
    officialUrl: scheme.officialUrl,
    formPath: scheme.formPath,
  };
}

/**
 * The plate mark on each scheme card.
 *
 * Karigari stores no imagery against a scheme, so rather than borrowing an
 * unrelated craft photo and implying it depicts the programme, each card gets a
 * large, low-contrast glyph for the kind of body that runs it.
 */
export const SCHEME_MARK: Record<string, React.ReactNode> = {
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
export const SCHEME_TYPE_KEY: Record<string, string> = {
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
export function grantBadge(benefit: string, t: Translate): string {
  const match = benefit.match(/₹\s?[\d,]+(?:\s?lakh|\s?crore)?/i);
  return match
    ? t("schemes_benefit_suffix").replace("{amount}", match[0].replace(/\s+/g, " ").trim())
    : t("schemes_support_programme");
}

/**
 * One eligible scheme.
 *
 * The reference puts a photograph in the left panel. Karigari stores no imagery
 * against a scheme, so rather than borrowing an unrelated craft photo and
 * implying it depicts the programme, the panel is a typographic plate carrying
 * the benefit the scheme actually publishes.
 */
export function SchemeCard({
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

export function LockedCard({
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
