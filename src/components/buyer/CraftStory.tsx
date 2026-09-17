"use client";

import { useState } from "react";
import { Award, ChevronDown, Clock, Layers, MapPin, Mic, Phone, Users } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import {
  ADVANCE_RATE,
  FINAL_SETTLEMENT_RATE,
  PLATFORM_FEE_RATE,
  artisanSharePctFor,
} from "@/lib/escrow";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { BandMarker, ProgressBar } from "@/components/ui/ProgressBar";
import { SectionEyebrow, SectionHeading } from "@/components/ui/SectionEyebrow";
import type { Passport } from "@/lib/passport";
import { fill, languageName } from "@/components/buyer/passportFormat";

/**
 * The craft story: who made the piece, how it was made and recorded, and what
 * the maker is paid for it.
 *
 * Every line is conditional on a real field. No fallback bio (a Rajasthani
 * potter was once described as a Pochampally weaver), no GI line unless the
 * profile is certified, no "expected payout" — before a sale the artisan has
 * received ₹0, and the page says the piece is not yet sold. Escrow percentages
 * come from src/lib/escrow.ts.
 */

/** A bio longer than this starts clamped, with a toggle. */
const BIO_CLAMP_CHARS = 240;

const pct = (rate: number) => Number((rate * 100).toFixed(2)).toString();

export function CraftStory({ passport }: { passport: Passport }) {
  const { t } = useLanguage();
  const [bioOpen, setBioOpen] = useState(false);
  const { artisan, received } = passport;

  const language = passport.voiceLanguage ? languageName(passport.voiceLanguage, t) : null;
  const catalogued =
    passport.catalogMethod === "VOICE"
      ? { icon: <Mic size={14} />, text: language ? fill(t("story_catalogued_by_voice"), { language }) : t("story_catalogued_by_voice_plain") }
      : passport.catalogMethod === "IVR"
        ? { icon: <Phone size={14} />, text: language ? fill(t("story_catalogued_by_phone"), { language }) : t("story_catalogued_by_phone_plain") }
        : null;

  const price = passport.price;
  const floor = passport.fairWageFloor && passport.fairWageFloor > 0 ? passport.fairWageFloor : null;
  const bandMax = price !== null ? Math.max(price, passport.marketPriceMax ?? 0) : 0;
  const longBio = (artisan.bio?.length ?? 0) > BIO_CLAMP_CHARS;
  const hasMaking = Boolean(
    passport.laborDays !== null || passport.material || catalogued || passport.descriptionOriginal || passport.descriptionEnglish
  );

  return (
    <section aria-labelledby="passport-story" className="space-y-4">
      <SectionHeading id="passport-story" size="sm">
        {t("story_title")}
      </SectionHeading>

      <div className="grid gap-4 lg:grid-cols-2">
      {/* ------------------------------------------------------------ artisan */}
      <Card pad="lg" className="kg-enter lg:col-span-2">
        <SectionEyebrow>{t("story_made_by")}</SectionEyebrow>
        <div className="mt-3 flex items-start gap-4">
          <Avatar name={artisan.name} src={artisan.photoUrl} size={64} />
          <div className="min-w-0 flex-1">
            <p className="kg-display text-[22px] leading-tight text-gray-900 [overflow-wrap:anywhere]">{artisan.name}</p>
            <ul className="mt-2 space-y-1 text-[13px] text-gray-600">
              {artisan.location && (
                <li className="flex items-start gap-1.5">
                  <MapPin size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
                  <span className="[overflow-wrap:anywhere]">
                    <span className="sr-only">{t("story_village")}: </span>
                    {artisan.location}
                  </span>
                </li>
              )}
              {artisan.craftType && (
                <li className="flex items-start gap-1.5">
                  <Layers size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
                  <span className="line-clamp-2 [overflow-wrap:anywhere]">
                    <span className="sr-only">{t("story_craft")}: </span>
                    {artisan.craftType}
                  </span>
                </li>
              )}
              {artisan.experienceYears !== null && (
                <li className="flex items-start gap-1.5">
                  <Clock size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
                  {fill(t("story_experience"), { n: artisan.experienceYears })}
                </li>
              )}
              {artisan.clusterName && (
                <li className="flex items-start gap-1.5">
                  <Users size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
                  <span className="line-clamp-2 [overflow-wrap:anywhere]">{artisan.clusterName}</span>
                </li>
              )}
            </ul>
            {artisan.gi && (
              <p className="kg-label mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-pink)] px-3 py-1.5 font-semibold text-[var(--color-maroon)]">
                <Award size={12} aria-hidden /> {fill(t("story_gi"), { label: artisan.gi })}
              </p>
            )}
          </div>
        </div>
        {artisan.bio && (
          <div className="mt-4">
            <p className={`text-[14px] leading-relaxed text-gray-600 [overflow-wrap:anywhere] ${longBio && !bioOpen ? "line-clamp-4" : ""}`}>
              {artisan.bio}
            </p>
            {longBio && (
              <button
                type="button"
                onClick={() => setBioOpen((open) => !open)}
                aria-expanded={bioOpen}
                className="kg-press mt-1 min-h-[40px] text-[13px] font-semibold text-gray-900 underline-offset-2 hover:underline"
              >
                {bioOpen ? t("story_read_less") : t("story_read_more")}
              </button>
            )}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------ the making */}
      {hasMaking && (
        <Card pad="lg">
          <SectionEyebrow>{t("story_making")}</SectionEyebrow>
          <ul className="mt-3 flex flex-wrap gap-2">
            {passport.laborDays !== null && (
              <li className="rounded-full bg-[var(--color-pill)] px-3 py-1.5 text-[13px] text-gray-800">
                {fill(t("story_labor_days"), { n: passport.laborDays })}
              </li>
            )}
            {passport.material && (
              <li className="rounded-full bg-[var(--color-pill)] px-3 py-1.5 text-[13px] text-gray-800 first-letter:uppercase">
                {fill(t("story_material"), { material: passport.material.value })}
              </li>
            )}
          </ul>
          {catalogued && (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-gray-700">
              <span className="text-[var(--color-rust)]" aria-hidden>
                {catalogued.icon}
              </span>
              {catalogued.text}
            </p>
          )}
          {passport.descriptionOriginal && (
            <blockquote className="mt-4 rounded-xl border border-gray-100 bg-[var(--color-gray-50)] p-3 text-[14px] italic leading-relaxed text-gray-700 [overflow-wrap:anywhere]">
              <span className="kg-label mb-1 block not-italic font-medium text-gray-500">{t("story_own_words")}</span>
              <span className="line-clamp-6">&ldquo;{passport.descriptionOriginal}&rdquo;</span>
            </blockquote>
          )}
          {passport.descriptionEnglish && passport.descriptionEnglish !== passport.descriptionOriginal && (
            <div className="mt-3">
              <span className="kg-label block font-medium text-gray-500">{t("story_translation")}</span>
              <p className="mt-1 line-clamp-6 text-[14px] leading-relaxed text-gray-700 [overflow-wrap:anywhere]">{passport.descriptionEnglish}</p>
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------------ fair pay */}
      <Card pad="lg" className={hasMaking ? undefined : "lg:col-span-2"}>
        <SectionEyebrow>{t("story_fair_pay")}</SectionEyebrow>
        {price !== null ? (
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="kg-display text-[34px] leading-none text-gray-900">{artisanSharePctFor(price).toFixed(2)}%</p>
              <p className="mt-1 text-[13px] text-gray-600">{fill(t("story_fair_share"), { price: formatRupees(price) })}</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-gray-600">{t("story_price_not_set")}</p>
        )}

        {floor !== null && price !== null && (
          <div className="mt-5 space-y-3">
            <div>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-gray-700">{fill(t("story_fair_floor"), { floor: formatRupees(floor) })}</span>
                <span className="font-mono text-[12px] text-gray-500">
                  {fill(t("story_floor_share"), { pct: Math.round((floor / price) * 100) })}
                </span>
              </div>
              <ProgressBar value={floor} max={price} tone="success" label={t("story_fair_floor_label")} className="mt-2" />
            </div>
            <BandMarker
              min={floor}
              max={bandMax}
              value={price}
              minLabel={formatRupees(floor)}
              maxLabel={formatRupees(bandMax)}
              caption={fill(t("story_listed_at"), { price: formatRupees(price) })}
            />
          </div>
        )}

        <div className="mt-5 border-t border-gray-100 pt-4">
          <span className="kg-label block font-medium text-gray-500">{t("story_artisan_received")}</span>
          <p className="kg-display mt-1 text-[26px] leading-none text-gray-900">{formatRupees(received.total)}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">
            {received.state === "NOT_SOLD"
              ? t("story_not_yet_sold")
              : received.state === "HELD"
                ? t("story_received_held")
                : fill(t("story_received_parts"), { advance: formatRupees(received.advance), final: formatRupees(received.final) })}
          </p>
          {received.state === "RELEASED" && received.simulated && (
            <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{t("story_payout_simulated")}</p>
          )}
        </div>

        <details className="group mt-4 rounded-xl border border-gray-200 bg-[var(--color-gray-50)]">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 text-[13px] font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
            {t("story_escrow_title")}
            <ChevronDown size={16} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="border-t border-gray-100 px-3.5 py-3 text-[13px] leading-relaxed text-gray-600">
            {fill(t("story_escrow_explainer"), {
              advance: pct(ADVANCE_RATE),
              final: pct(FINAL_SETTLEMENT_RATE),
              total: pct(ADVANCE_RATE + FINAL_SETTLEMENT_RATE),
              fee: pct(PLATFORM_FEE_RATE),
            })}
          </p>
        </details>
      </Card>
      </div>
    </section>
  );
}
