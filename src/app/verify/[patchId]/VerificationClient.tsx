"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleSlash, QrCode, ShieldCheck, Sparkles } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { CREATOR_RATE } from "@/lib/escrow";
import { SCAN_QUERY_KEY, SCAN_QUERY_VALUE } from "@/lib/qrPatch";
import { captureRefFromUrl } from "@/lib/affiliateRef";
import type { Passport } from "@/lib/passport";
import { Card } from "@/components/ui/Card";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { PassportGallery } from "@/components/buyer/PassportGallery";
import { CraftStory } from "@/components/buyer/CraftStory";
import { ProvenanceTimeline } from "@/components/buyer/ProvenanceTimeline";
import { TrustLayers } from "@/components/buyer/TrustLayers";
import { SimilarRequest } from "@/components/buyer/SimilarRequest";
import { MoreFromArtisan } from "@/components/buyer/MoreFromArtisan";
import { fill } from "@/components/buyer/passportFormat";

/**
 * The digital craft passport — what someone sees when they scan the patch on a
 * physical piece.
 *
 * Server-rendered from `loadPassportByPatchId()`, an allow-listed record: no
 * contact, bank or identity field of the artisan and nothing about the buyer
 * reaches this component. Every section below renders only what that record
 * holds; see src/lib/passportFacts.ts for the rules.
 */
export function VerificationClient({ passport }: { passport: Passport }) {
  const { t } = useLanguage();

  /**
   * The creator who sent this visitor, when the passport was reached through
   * their link. Read on the client only: the page is server-rendered from the
   * patch id, and `?ref=` is not part of that identity.
   */
  const [ref, setRef] = useState("");
  /**
   * True when the visitor arrived by scanning the physical patch QR, which
   * carries `?scan=1`. Read from `window.location.search` in a deferred effect
   * rather than `useSearchParams`, so this page still needs no Suspense
   * boundary — the same pattern `src/lib/urlTab.ts` uses.
   */
  const [scannedViaQr, setScannedViaQr] = useState(false);
  useEffect(() => {
    const kickoff = setTimeout(() => {
      setRef(captureRefFromUrl());
      setScannedViaQr(new URLSearchParams(window.location.search).get(SCAN_QUERY_KEY) === SCAN_QUERY_VALUE);
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const qrStep = passport.timeline.find((step) => step.key === "qr_attached");
  const { artisan } = passport;

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-20 font-sans">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" aria-label="Karigari">
          <KarigariLogo size={26} showWordmark />
        </Link>
        <LanguageSwitcher />
      </div>

      {/* ------------------------------------------------------------ hero */}
      <header className="bg-primary px-4 pb-20 pt-10 text-white sm:pt-12">
        <div className="mx-auto max-w-5xl">
          <SectionEyebrow tone="light">{t("passport_eyebrow")}</SectionEyebrow>
          <h1 className="kg-display mt-3 line-clamp-3 text-[32px] leading-tight [overflow-wrap:anywhere] sm:text-[44px]">
            {passport.craftType}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/70 [overflow-wrap:anywhere]">
            {artisan.location
              ? fill(t("passport_made_by_in"), { name: artisan.name, place: artisan.location })
              : fill(t("passport_made_by"), { name: artisan.name })}
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {qrStep?.state === "DONE" && (
              <li className="kg-label inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-medium text-white">
                <ShieldCheck size={12} aria-hidden /> {t("passport_badge_patch_matched")}
              </li>
            )}
            {qrStep?.state === "WAIVED" && (
              <li className="kg-label inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-medium text-white">
                <CircleSlash size={12} aria-hidden /> {t("timeline_qr_waived")}
              </li>
            )}
            {passport.sold && (
              <li className="kg-label inline-flex items-center rounded-full bg-[var(--color-pink)] px-3 py-1.5 font-semibold text-[var(--color-maroon)]">
                {t("passport_sold")}
              </li>
            )}
            {scannedViaQr && (
              <li className="kg-label inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-medium text-white">
                <QrCode size={12} aria-hidden /> {t("scanned_via_qr")}
              </li>
            )}
            {passport.patchId && (
              <li className="kg-label inline-flex items-center rounded-full bg-white/10 px-3 py-1.5 font-medium text-white/80 [overflow-wrap:anywhere]">
                {passport.patchId}
              </li>
            )}
          </ul>
        </div>
      </header>

      <main className="relative -mt-12 mx-auto max-w-5xl space-y-10 px-4">
        {ref && (
          <div className="kg-enter flex items-start gap-2.5 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3.5">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-orange-900">
                {t("endorsed_by")} @{ref}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-orange-800/80">
                {fill(t("creator_commission_note"), { pct: Math.round(CREATOR_RATE * 100) })}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-4 sm:mx-auto sm:w-full sm:max-w-lg lg:max-w-none">
            <PassportGallery images={passport.images} variants={passport.variants} alt={passport.craftType} priority />
            <Card pad="md">
              {passport.sold ? (
                <p className="text-[14px] font-semibold text-gray-900">{t("passport_sold_note")}</p>
              ) : passport.buyable ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="kg-label block font-medium text-gray-500">{t("passport_price")}</span>
                    <span className="kg-display text-[26px] leading-none text-gray-900">
                      {passport.price !== null ? formatRupees(passport.price) : t("price_not_set")}
                    </span>
                  </div>
                  <Link
                    href={`/marketplace/product/${passport.id}`}
                    className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
                  >
                    {t("passport_view_in_marketplace")} <ArrowRight size={15} aria-hidden />
                  </Link>
                </div>
              ) : (
                <p className="text-[14px] text-gray-700">{t("passport_not_for_sale")}</p>
              )}
            </Card>
          </div>
          <Card pad="lg">
            <ProvenanceTimeline steps={passport.timeline} />
          </Card>
        </div>

        <CraftStory passport={passport} />
        <TrustLayers trust={passport.trust} />
        <SimilarRequest draft={passport.demandDraft} imageSrc={passport.images[0]?.src ?? null} />
        <MoreFromArtisan items={passport.moreFromArtisan} artisanName={artisan.name} />

        <footer className="border-t border-gray-200 pt-6 text-center text-[13px] text-gray-500">
          <p>{t("passport_footer")}</p>
          <Link href="/" className="mt-1 inline-block underline underline-offset-2 hover:text-gray-900">
            {t("passport_footer_link")}
          </Link>
        </footer>
      </main>
    </div>
  );
}
