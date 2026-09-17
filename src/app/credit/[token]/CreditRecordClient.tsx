"use client";

import { BadgeCheck, CircleSlash, Link2Off, Printer } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { CREDIT_ALGO_VERSION } from "@/lib/creditScore";
import type { PublicCreditRecord } from "@/lib/creditRecord";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { SectionLabel } from "@/components/ui/SectionLabel";
import {
  CreditComponentList,
  CreditCountsTable,
  CreditDisclaimer,
  CreditFormula,
  CreditGauge,
  fill,
} from "@/components/CreditRecordParts";

/**
 * Pinned locale and time zone, so the server render and the hydrated client
 * print the same date — and IST is the zone the record was made in.
 */
const IST_STAMP: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
};
const stamp = (iso: string) => `${new Date(iso).toLocaleString("en-IN", IST_STAMP)} IST`;

/**
 * One A4 sheet when printed: the page chrome disappears, the two-column body
 * holds, and the whole record is scaled to fit. This stands in for a PDF export
 * — there is no PDF library in this app, by design.
 */
const PRINT_CSS = `
@page { size: A4; margin: 9mm; }
@media print {
  html, body { background: var(--color-card) !important; height: auto !important; min-height: 0 !important; }
  nextjs-portal { display: none !important; }
  .kg-credit-record { zoom: 0.64; }
  .kg-credit-record * { box-shadow: none !important; animation: none !important; }
}
`;

export function CreditRecordClient({ record }: { record: PublicCreditRecord | null }) {
  const { t } = useLanguage();

  if (!record) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
        <Card pad="lg" className="w-full max-w-md text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-pill)] text-gray-600">
            <Link2Off size={22} aria-hidden />
          </span>
          <h1 className="kg-display mt-4 text-[24px] leading-snug text-gray-900">{t("credit_share_expired")}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t("credit_public_gone_body")}</p>
          <div className="mt-6 flex justify-center">
            <KarigariLogo size={26} showWordmark />
          </div>
        </Card>
      </main>
    );
  }

  const { profile, artisan } = record;
  const scored = profile.eligible && profile.score !== null && profile.band !== null;
  const subtitle = [artisan.craftType, artisan.location].filter(Boolean).join(" · ");

  return (
    <main className="min-h-screen bg-[var(--color-background)] px-4 py-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="kg-credit-record mx-auto max-w-4xl space-y-5 print:max-w-none">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <KarigariLogo size={28} showWordmark />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => window.print()}
              className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white hover:bg-primary-dark"
            >
              <Printer size={15} aria-hidden /> {t("credit_public_print")}
            </button>
          </div>
        </div>

        <Card pad="lg" className="break-inside-avoid">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="hidden print:block">
                <KarigariLogo size={22} showWordmark />
              </div>
              <p className="kg-label mt-1 font-semibold text-[var(--color-maroon)]">{t("credit_public_title")}</p>
              <div className="mt-3 flex items-center gap-3">
                <Avatar name={artisan.name} src={artisan.photoUrl} size={56} />
                <div className="min-w-0">
                  <h1 className="kg-display text-[26px] leading-tight text-gray-900 [overflow-wrap:anywhere]">{artisan.name}</h1>
                  {subtitle && <p className="mt-0.5 text-[14px] text-gray-600 [overflow-wrap:anywhere]">{subtitle}</p>}
                </div>
              </div>
            </div>
            <div className="space-y-1 text-[12.5px] text-gray-600 sm:text-right">
              <p>{fill(t("credit_public_generated"), { date: stamp(record.createdAt) })}</p>
              <p>{fill(t("credit_public_expires"), { date: stamp(record.expiresAt) })}</p>
              {record.sharedWith && (
                <p className="font-semibold text-gray-800 [overflow-wrap:anywhere]">
                  {fill(t("credit_public_prepared_for"), { who: record.sharedWith })}
                </p>
              )}
            </div>
          </div>

          <CreditDisclaimer className="mt-5" />

          <div className="mt-4 grid gap-3 text-[12.5px] leading-relaxed sm:grid-cols-2">
            <p className="flex items-start gap-2 text-gray-700">
              <BadgeCheck size={15} className="mt-0.5 shrink-0 text-[var(--color-stat-teal)]" aria-hidden />
              <span>{t("credit_public_verified_note")}</span>
            </p>
            <p className="flex items-start gap-2 text-gray-700">
              <CircleSlash size={15} className="mt-0.5 shrink-0 text-[var(--color-rust)]" aria-hidden />
              <span>{t("credit_public_not_verified_note")}</span>
            </p>
          </div>

          {record.version < CREDIT_ALGO_VERSION && (
            <p className="mt-4 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-[12.5px] text-orange-800">
              {fill(t("credit_public_version_note"), { v: record.version, current: CREDIT_ALGO_VERSION })}
            </p>
          )}
        </Card>

        <div className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] print:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="space-y-5">
            <Card pad="lg" className="break-inside-avoid">
              {scored ? (
                <CreditGauge score={profile.score as number} band={profile.band!} />
              ) : (
                <p className="text-[14px] leading-relaxed text-gray-700">{t("credit_public_withheld")}</p>
              )}
            </Card>
            <Card pad="md" className="break-inside-avoid">
              <SectionLabel>{t("credit_public_counts_title")}</SectionLabel>
              <CreditCountsTable profile={profile} />
            </Card>
          </div>
          {/* Components and the formula share the wider column, so the printed
              record balances into two columns and fits one A4 sheet. */}
          {scored && (
            <div className="space-y-5">
              <Card pad="lg" className="break-inside-avoid">
                <SectionLabel>{t("credit_components_title")}</SectionLabel>
                <CreditComponentList profile={profile} />
              </Card>
              <Card pad="lg" className="break-inside-avoid">
                <SectionLabel>{t("credit_how_calculated")}</SectionLabel>
                <CreditFormula profile={profile} />
              </Card>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
