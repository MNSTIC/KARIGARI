"use client";

import { useState } from "react";
import Image from "next/image";
import { CheckCircle2, ShieldCheck, Clock, MapPin, Scissors, Tag, Info, Mic } from "lucide-react";
import Link from "next/link";
import { VerificationCamera } from "@/components/VerificationCamera";
import { formatRupees, getListingPrice } from "@/lib/pricing";

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
  const [isPurchased, setIsPurchased] = useState(item.status === 'SOLD_FINAL' || item.status === 'SOLD_MIDDLEMAN');

  // Money on the passport is only ever money that moved. An advance exists once
  // the artisan has claimed it after verification; before that it is ₹0, not the
  // AI valuation and not a placeholder.
  const advancePaid = Number(item.advancePaid) || 0;
  const finalPayout = Number(item.finalPayoutQueued) || 0;
  const artisanReceived = advancePaid + finalPayout;
  const listingPrice = getListingPrice(item);

  const artisanName = item.artisan?.name || "Unknown Artisan";
  const artisanProfile = item.artisan?.artisanProfile;
  const photoUrl = artisanProfile?.photoUrl || "/female_artisan.jpg";
  const artisanBio = artisanProfile?.description || "An artisan from Pochampally Cooperative dedicated to handloom crafts.";
  const artisanTags = artisanProfile?.tags || ["Artisan"];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center pb-20 font-sans selection:bg-primary/20">
      
      {/* Top Banner */}
      <div className="w-full bg-primary text-white py-8 px-4 flex flex-col items-center justify-center text-center shadow-md relative z-10">
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg text-green-500 animate-[bounce_2s_infinite]">
          <ShieldCheck size={40} />
        </div>
        <h1 className="font-serif font-bold text-3xl mb-2 tracking-tight">Authentic. Fair. Verified.</h1>
        <p className="text-primary-light font-medium max-w-sm text-sm">
          {isPurchased 
            ? "Thank you for your purchase. Meet the artisan behind your craft."
            : "This craft item is genuine. Verify the texture below to unlock purchase options."}
        </p>
      </div>

      <div className="w-full max-w-md -mt-6 px-4 relative z-20 flex flex-col gap-6">
        
        {/* Main Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden flex flex-col animate-fade-in-up">
          <div className="relative aspect-[4/3] w-full bg-gray-100">
            <Image 
              src={item.images?.[0] || "/ikat_saree.jpg"} 
              alt={item.craftType} 
              fill 
              sizes="(max-width: 768px) 100vw, 640px"
              className="object-cover" 
              priority
            />
            <div className="absolute top-4 right-4 flex flex-col gap-2"><div className="bg-white/90 backdrop-blur-sm text-green-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-sm"><CheckCircle2 size={14} /> Karigari Verified Product</div><div className="bg-white/90 backdrop-blur-sm text-blue-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-sm"><ShieldCheck size={14} /> Karigari Verified Artisan</div></div>
          </div>
          
          <div className="p-6">
            <h2 className="text-2xl font-serif font-bold text-gray-900 mb-1">{item.craftType}</h2>
            <p className="text-sm text-primary font-bold mb-6 flex items-center gap-1">
              <MapPin size={14} /> {isPurchased ? (artisanProfile?.location || "Pochampally Weavers Cooperative") : "Geographic Origin Protected"}
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase font-bold tracking-wider flex items-center gap-1">
                  <Clock size={12} /> Time to Make
                </span>
                <span className="font-medium text-gray-900">{item.laborDays || 9} Days</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 uppercase font-bold tracking-wider flex items-center gap-1">
                  <Scissors size={12} /> Material Cost
                </span>
                <span className="font-medium text-gray-900">
                  {isPurchased ? `₹${item.rawMaterialCost || 2800}` : "Hidden until purchase"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive AI Authenticity Camera */}
        {!isPurchased && (
          <VerificationCamera 
            patchId={patchId} 
            onPurchaseComplete={() => setIsPurchased(true)}
          />
        )}

        {/* POST PURCHASE REVEAL */}
        {isPurchased && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            {/* Artisan Profile Block */}
            <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-6 flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-full overflow-hidden mb-4 border-4 border-primary/20 relative">
                <Image src={photoUrl} alt={artisanName} fill sizes="96px" className="object-cover" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Crafted by {artisanName}</h3>
              <p className="text-sm text-gray-500 mb-4 px-2">{artisanBio}</p>
              
              <div className="flex flex-wrap gap-2 justify-center">
                {artisanTags.map((tag: string, i: number) => (
                  <span key={i} className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-bold flex items-center gap-1">
                    <Tag size={10} /> {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Fair Pay Confirmation Block */}
            <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-6">
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
            <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-6">
              <h3 className="font-bold text-lg text-gray-900 mb-4 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Mic size={18} />
                </div>
                The Item's Story
              </h3>
              
              <div className="space-y-4">
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">In their own words</span>
                  <p className="text-sm text-gray-600 italic bg-gray-50 p-3 rounded-xl border border-gray-100">
                    "{item.descriptionOriginal || "చేనేత పోచంపల్లి ఇక్కత్ పట్టు చీర"}"
                  </p>
                </div>
                <div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">English Translation</span>
                  <p className="text-md text-primary font-medium">
                    {item.descriptionEnglish || "Handwoven authentic craft"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Audit Log Timeline Block */}
        <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-6 animate-fade-in-up mt-6">
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
