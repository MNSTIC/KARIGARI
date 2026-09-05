"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, ShieldCheck, Clock, MapPin, QrCode, Scissors, Tag, Info, Mic, Sparkles, Scale } from "lucide-react";
import Link from "next/link";
import { formatRupees, getListingPrice } from "@/lib/pricing";
import { useLanguage } from "@/lib/translations";
import { SCAN_QUERY_KEY, SCAN_QUERY_VALUE } from "@/lib/qrPatch";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { VerifiedOriginBadge } from "@/components/ui/Badge";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BandMarker, ProgressBar } from "@/components/ui/ProgressBar";
import { captureRefFromUrl } from "@/lib/affiliateRef";

/**
 * Pinned locale AND time zone. `toLocaleDateString()` with neither renders in
 * the server's zone during SSR and the visitor's on hydration, which was
 * throwing "Hydration failed because the server rendered text..." on every
 * passport load. IST is also the right zone to show an Indian artisan.
 */
const STAMP_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
};

function formatStamp(value: string | Date): string {
  return `${new Date(value).toLocaleString('en-IN', STAMP_FORMAT)} IST`;
}

export function VerificationClient({ item, patchId }: { item: any, patchId: string }) {
  const { t } = useLanguage();
  const [isPurchased, setIsPurchased] = useState(item.status === 'SOLD_FINAL' || item.status === 'SOLD_MIDDLEMAN');

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
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState, matching the pattern used across the client pages.
    const kickoff = setTimeout(() => {
      setRef(captureRefFromUrl());
      setScannedViaQr(
        new URLSearchParams(window.location.search).get(SCAN_QUERY_KEY) === SCAN_QUERY_VALUE
      );
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  // Money on the passport is only ever money that moved. An advance exists once
  // the artisan has claimed it after verification; before that it is ₹0, not the
  // AI valuation and not a placeholder.
  const advancePaid = Number(item.advancePaid) || 0;
  const finalPayout = Number(item.finalPayoutQueued) || 0;
  const artisanReceived = advancePaid + finalPayout;
  const listingPrice = getListingPrice(item);

  const artisanName = item.artisan?.name || "Unknown Artisan";
  const artisanProfile = item.artisan?.artisanProfile;
  const photoUrl = artisanProfile?.photoUrl || null;
  /* Placeholders that named a specific real cooperative used to sit here, so a
     Rajasthani potter was described as a Pochampally handloom weaver. A profile
     with nothing written says nothing. */
  const artisanBio = artisanProfile?.description || "";
  const artisanTags: string[] = artisanProfile?.tags || [];

  return (
    <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center pb-20 font-sans">
      
      {/* Top Banner */}
      <div className="relative z-10 flex w-full flex-col items-center justify-center bg-primary px-4 pb-16 pt-14 text-center text-white">
        <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
          <ShieldCheck size={26} strokeWidth={1.6} />
        </span>
        <SectionEyebrow tone="light">Digital craft passport</SectionEyebrow>
        <h1 className="kg-display mt-3 text-[32px] leading-tight sm:text-[40px]">
          Authentic. Fair. Verified.
        </h1>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/65">
          {isPurchased 
            ? "Thank you for your purchase. Meet the artisan behind your craft."
            : "This craft item is genuine. Verify the texture below to unlock purchase options."}
        </p>
      </div>

      <div className="relative z-20 -mt-10 flex w-full max-w-md flex-col gap-6 px-4">

        {/* Creator endorsement. Above the fold, because the person who sent the
            buyer here is part of why they trust the piece. */}
        {ref && (
          <div className="kg-enter flex items-start gap-2.5 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3.5">
            <Sparkles size={18} className="shrink-0 mt-0.5 text-amber-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-orange-900 break-words">
                Curated &amp; Recommended by @{ref}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-orange-800/80">
                They earn 5% of this sale, paid direct to their own UPI on delivery. The
                artisan&rsquo;s share is unchanged.
              </p>
            </div>
          </div>
        )}

        {/* Main Card */}
        <div className="kg-enter flex flex-col overflow-hidden rounded-3xl border border-gray-200/70 bg-card shadow-soft">
          <div className="relative aspect-[4/3] w-full bg-gray-100">
            <Image 
              src={item.images?.[0] || "/ikat_saree.jpg"}
              unoptimized={String(item.images?.[0] || "").startsWith("data:") || String(item.images?.[0] || "").startsWith("/api/")} 
              alt={item.craftType} 
              fill 
              sizes="(max-width: 768px) 100vw, 640px"
              className="object-cover" 
              priority
            />
            <div className="absolute left-4 top-4 flex flex-col items-start gap-2">
              <VerifiedOriginBadge />
              <span className="kg-label rounded-full bg-white/90 px-2.5 py-1.5 font-medium text-gray-600 backdrop-blur-sm">
                ID: {patchId}
              </span>
              {/* Where this visit came from. Only shown for a real QR scan, so
                  the provenance of the page itself is visible too. */}
              {scannedViaQr && (
                <span className="kg-label inline-flex items-center gap-1.5 rounded-full bg-[var(--color-mint)]/95 px-2.5 py-1.5 font-medium text-primary backdrop-blur-sm">
                  <QrCode size={12} /> {t("scanned_via_qr")}
                </span>
              )}
            </div>
          </div>
          
          <div className="p-6">
            <h2 className="kg-display mb-2 text-[26px] leading-tight text-gray-900">
              {item.craftType}
            </h2>
            <p className="mb-6 flex items-center gap-1.5 text-[14px] font-medium text-gray-600">
              <MapPin size={14} className="text-gray-400" />{" "}
              {isPurchased
                ? artisanProfile?.location || artisanProfile?.clusterName || "Origin not recorded"
                : "Geographic Origin Protected"}
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="kg-label flex items-center gap-1.5 font-medium text-gray-500">
                  <Clock size={12} /> Time to make
                </span>
                {/* No invented default: a piece captured without a labour
                    figure says so rather than borrowing a plausible number. */}
                <span className="font-medium text-gray-900">
                  {item.laborDays ? `${item.laborDays} Days` : "Not recorded"}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="kg-label flex items-center gap-1.5 font-medium text-gray-500">
                  <Scissors size={12} /> Material cost
                </span>
                <span className="font-sans font-medium text-gray-900">
                  {isPurchased ? formatRupees(item.rawMaterialCost) : "Hidden until purchase"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Fair Value Ledger - the numbers the passport exists to publish. */}
        <Card pad="lg" className="kg-enter">
          <SectionLabel>Fair value ledger</SectionLabel>

          <SectionEyebrow>Fair wage floor</SectionEyebrow>
          {/* Safe in the display face: globals.css keeps Inter last in the serif
              stack, so U+20B9 falls through to a font that can draw it. */}
          <p className="kg-display mb-3 mt-1 text-[26px] leading-none text-gray-900">
            {formatRupees(item.fairWageFloor)}
          </p>
          <ProgressBar
            value={Number(item.fairWageFloor) || 0}
            max={Number(item.marketPriceMax) || Number(item.fairWageFloor) || 1}
            tone="success"
            label="Fair wage floor"
            className="mb-6"
          />

          {Number(item.marketPriceMax) > 0 && (
            <>
              <SectionEyebrow className="mb-2">Market price band</SectionEyebrow>
              <BandMarker
                min={Number(item.marketPriceMin) || 0}
                max={Number(item.marketPriceMax) || 0}
                value={listingPrice ?? (Number(item.marketPriceMin) || 0)}
                minLabel={formatRupees(item.marketPriceMin)}
                maxLabel={formatRupees(item.marketPriceMax)}
                caption={`Listed at ${formatRupees(listingPrice)}`}
              />
            </>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <span className="kg-label flex items-center gap-1.5 font-medium text-gray-500">
              <Scale size={13} /> Authenticity score
            </span>
            <span className="text-sm font-semibold text-gray-900">
              {item.fairnessScore ? `${Math.round(Number(item.fairnessScore))}%` : "Not scored"}
            </span>
          </div>
        </Card>

        {/* The interactive "Verify Authenticity" camera used to live here. The
            authenticity guarantee now comes from the physical QR patch: the
            artisan attaches it, re-photographs the product, and the AI matches
            that photo to the original capture before the item can be sold. */}
        {!isPurchased && (
          <div className="rounded-3xl border border-gray-200/70 bg-card p-6 shadow-card">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="shrink-0 mt-0.5 text-primary" />
              <div>
                <h3 className="font-bold text-gray-900 mb-1">
                  {item.qrVerified
                    ? 'Authenticity confirmed — QR patch matched to the original craft'
                    : 'Scan the QR patch on the product to verify'}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {item.qrVerified
                    ? 'The artisan attached patch ' + patchId + ' to this piece and re-photographed it. The AI matched that photo against the original capture, so the code on the product and the record you are reading are the same item.'
                    : 'Every KARIGARI piece carries a printed QR patch. Scanning it on the physical product opens this passport — if the code leads here, the item in your hands is the one described on this page.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* POST PURCHASE REVEAL */}
        {isPurchased && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            {/* Artisan Profile Block */}
            <div className="flex flex-col items-center rounded-3xl border border-gray-200/70 bg-card p-6 text-center shadow-card">
              <div className="w-24 h-24 rounded-full overflow-hidden mb-4 border-4 border-gray-100 relative">
                <Avatar name={artisanName} src={photoUrl} size={96} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Crafted by {artisanName}</h3>
              {artisanBio && (
                <p className="text-sm text-gray-500 mb-4 px-2 leading-relaxed">{artisanBio}</p>
              )}
              
              <div className="flex flex-wrap gap-2 justify-center">
                {artisanTags.map((tag: string, i: number) => (
                  <span key={i} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-bold flex items-center gap-1">
                    <Tag size={10} /> {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Fair Pay Confirmation Block */}
            <div className="rounded-3xl border border-gray-200/70 bg-card p-6 shadow-card">
              <h3 className="font-bold text-lg text-gray-900 mb-4 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
                  <CheckCircle2 size={18} />
                </div>
                Fair Pay Confirmation
              </h3>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                  <span className="text-gray-600 font-medium">Fair Wage Floor</span>
                  <span className="font-bold text-gray-600">{formatRupees(item.fairWageFloor)}</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                  <span className="text-gray-600 font-medium">Artisan&apos;s Listed Price</span>
                  <span className="font-bold text-gray-900">{formatRupees(listingPrice)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-900 font-bold">Artisan Received</span>
                  <div className="text-right">
                    <span className="font-bold text-2xl text-primary">{formatRupees(artisanReceived)}</span>
                    {finalPayout > 0 && (
                      <span className="block text-xs text-gray-500 mt-1">
                        {formatRupees(advancePaid)} advance + {formatRupees(finalPayout)} final payout
                      </span>
                    )}
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-3">
                  <Info size={18} className="text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-green-800 leading-tight">
                    {artisanReceived > 0
                      ? "This artisan received an immediate fair wage advance. Your purchase has unlocked the remaining profits for them."
                      : "No payout has been disbursed on this item yet. The artisan is paid the fair wage floor as an advance the moment they claim it."}
                  </p>
                </div>
              </div>
            </div>

            {/* Artisan's Story Block */}
            <div className="rounded-3xl border border-gray-200/70 bg-card p-6 shadow-card">
              <h3 className="font-bold text-lg text-gray-900 mb-4 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Mic size={18} />
                </div>
                The Item's Story
              </h3>
              
              <div className="space-y-4">
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">In their own words</span>
                  {/* A hardcoded Telugu sentence used to stand in here, so a
                      Rajasthani potter's passport quoted a saree in a language
                      they do not speak. A piece with no recording says so. */}
                  {item.descriptionOriginal ? (
                    <p className="text-sm text-gray-600 italic bg-gray-50 p-3 rounded-xl border border-gray-100">
                      &ldquo;{item.descriptionOriginal}&rdquo;
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                      No recording in the artisan&rsquo;s own language was captured for this piece.
                    </p>
                  )}
                </div>
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">English Translation</span>
                  <p className="text-sm text-primary font-medium leading-relaxed">
                    {item.descriptionEnglish || (
                      <span className="text-gray-400 italic font-normal">
                        No English translation was recorded.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Audit Log Timeline Block */}
        <div className="kg-enter mt-6 rounded-3xl border border-gray-200/70 bg-card p-6 shadow-card">
          <h3 className="font-bold text-lg text-gray-900 mb-6 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock size={18} />
            </div>
            Product Timeline
          </h3>
          
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
            {item.auditLogs && item.auditLogs.length > 0 ? (
              item.auditLogs.map((log: any, index: number) => (
                <div key={log.id} className="relative flex items-start justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-white bg-blue-100 text-blue-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm relative z-10">
                    <CheckCircle2 size={14} />
                  </div>
                  
                  <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-gray-100 bg-gray-50 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm text-gray-900">{log.action.replace(/_/g, ' ')}</span>
                      {log.actorRole && (
                        <span className="text-[10px] uppercase font-bold text-gray-400 bg-gray-200 px-2 py-0.5 rounded">
                          {log.actorRole}
                        </span>
                      )}
                    </div>
                    <time className="text-xs font-medium text-blue-500 mb-2 block">
                      {formatStamp(log.createdAt)}
                    </time>
                    <p className="text-xs text-gray-600">
                      {log.comments || `State updated to ${log.newState?.status || 'Unknown'}`}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-sm text-gray-500 italic py-4">No timeline events recorded yet.</div>
            )}
          </div>
        </div>

      </div>

      <div className="mt-12 text-center text-gray-500 text-sm pb-8">
        <p>Verified by KARIGARI Heritage Engine</p>
        <Link href="/" className="hover:text-primary transition-colors underline">Learn more about our mission</Link>
      </div>

    </div>
  );
}
