"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Globe, ChevronDown, TrendingUp, Package, HandCoins, Banknote,
  LogOut, X, MapPin, Award, Camera, FileText, ArrowRightCircle, Clock, CheckCircle2,
  GraduationCap, Newspaper, QrCode, Globe2, Loader2
} from "lucide-react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useLanguage } from "@/lib/translations";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { NotificationsBell } from "@/components/NotificationsBell";
import { formatRupees, getListingPrice } from "@/lib/pricing";
import { StatCard } from "@/components/ui/StatCard";

/**
 * Modals are code-split out of the first paint.
 *
 * Every one of these was imported eagerly into the dashboard bundle even though
 * none of them renders until the artisan opens it — CaptureModal alone is ~44 KB
 * before its dependencies. `ssr: false` because they are all interaction-only.
 * Same pattern the insights page already uses for DemandMap.
 */
const CaptureModal = dynamic(
  () => import("@/components/CaptureModal").then((m) => m.CaptureModal),
  { ssr: false }
);
const AgentHandoffModal = dynamic(
  () => import("@/components/AgentHandoffModal").then((m) => m.AgentHandoffModal),
  { ssr: false }
);
const DisputeModal = dynamic(
  () => import("@/components/DisputeModal").then((m) => m.DisputeModal),
  { ssr: false }
);
const ProfileEditorModal = dynamic(
  () => import("@/components/ProfileEditorModal").then((m) => m.ProfileEditorModal),
  { ssr: false }
);
const LearningAssistantModal = dynamic(
  () => import("@/components/LearningAssistantModal").then((m) => m.LearningAssistantModal),
  { ssr: false }
);
const CompleteDraftModal = dynamic(
  () => import("@/components/CompleteDraftModal").then((m) => m.CompleteDraftModal),
  { ssr: false }
);
const QrAttachModal = dynamic(
  () => import("@/components/QrAttachModal").then((m) => m.QrAttachModal),
  { ssr: false }
);

export default function ArtisanDashboard() {
  const router = useRouter();
  const { t, language, changeLanguage } = useLanguage();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [isCrossCheckModalOpen, setIsCrossCheckModalOpen] = useState(false);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isLearningModalOpen, setIsLearningModalOpen] = useState(false);
  /** The IVR voice draft the artisan is finishing, if any. */
  const [draftItem, setDraftItem] = useState<any>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  /** The item whose physical QR patch is being attached and verified. */
  const [qrItem, setQrItem] = useState<any>(null);
  /** Per-row in-flight state for the List on ONDC action. */
  const [listingId, setListingId] = useState<string | null>(null);
  /** In-app banner for the listing action - never a browser alert. */
  const [listNotice, setListNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedDisputeItem, setSelectedDisputeItem] = useState<any>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/artisan/dashboard', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.success) {
        setDashboardData(data.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Deep link from the insights map ("complete profile"). Read straight off the
  // URL rather than via useSearchParams so this fully-client page needs no
  // Suspense boundary, and drop the param so a refresh does not reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("edit") !== "profile") return;

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — same pattern the insights and schemes pages use. The URL is
    // rewritten inside the callback, not beside it: StrictMode runs this effect
    // twice in dev, and stripping the param on the first pass (whose timer the
    // cleanup then cancels) left the second pass with nothing to act on.
    const kickoff = setTimeout(() => {
      setIsProfileEditorOpen(true);
      params.delete("edit");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Publish one capture to the ONDC channels.
   *
   * Gated on SELLABLE: an item is only sellable once the artisan has attached
   * the physical QR patch and the AI has matched the re-photographed piece to
   * the original capture. Listing before that would put something on the
   * marketplace that carries no verifiable patch.
   */
  const listOnOndc = async (item: any) => {
    if (item.status !== 'SELLABLE') {
      setListNotice({ tone: 'warn', text: t('list_requires_sellable') });
      return;
    }
    setListingId(item.id);
    setListNotice(null);
    try {
      const res = await fetch('/api/artisan/syndicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          craftItemId: item.id,
          targetPlatforms: ['ONDC_PAYTM', 'ONDC_MAGICPIN'],
        }),
      });
      const data = await res.json();
      if (data?.success) {
        setListNotice({ tone: 'ok', text: t('list_success') });
        await fetchDashboardData();
      } else {
        setListNotice({ tone: 'warn', text: data?.error || t('list_failed') });
      }
    } catch (e) {
      console.error('List on ONDC failed:', e);
      setListNotice({ tone: 'warn', text: t('list_failed') });
    } finally {
      setListingId(null);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    fetchDashboardData();
  };

  const flaggedItems = dashboardData?.recentCaptures?.filter((item: any) => item.status === 'FLAGGED' || item.status === 'REPORTED') || [];
  const healthScore = Math.max(0, 100 - (flaggedItems.length * 15));

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-16">
      {/* HEADER - OLD DESIGN */}
      <header className="flex justify-between items-center px-4 sm:px-8 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-12">
          <KarigariLogo variant="dark" showWordmark={true} size={32} />
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          {/* Language Selector */}
          <div className="relative group cursor-pointer" onMouseEnter={() => setShowLangMenu(true)} onMouseLeave={() => setShowLangMenu(false)}>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors py-2">
              <Globe size={16} />
              <span className="uppercase">{language}</span>
              <ChevronDown size={14} />
            </div>
            {showLangMenu && (
              <div className="absolute right-0 top-full w-32 pt-1 z-50">
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 animate-fade-in-up overflow-hidden">
                  <button onClick={() => { changeLanguage('en'); setShowLangMenu(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 font-medium">English</button>
                  <button onClick={() => { changeLanguage('hi'); setShowLangMenu(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 font-medium">हिंदी</button>
                  <button onClick={() => { changeLanguage('or'); setShowLangMenu(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 font-medium">ଓଡିଆ</button>
                  <button onClick={() => { changeLanguage('te'); setShowLangMenu(false); }} className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 font-medium">తెలుగు</button>
                </div>
              </div>
            )}
          </div>
          
          {/* Notifications — real Notification rows plus any locally flagged items */}
          <NotificationsBell
            localAlerts={flaggedItems.map((item: any) => ({
              id: item.id,
              title: t('attention_required'),
              message: `${item.craftType} — ${t('item_flagged')}`,
            }))}
          />

          <div 
            className="w-[34px] h-[34px] rounded-full overflow-hidden border border-gray-200 cursor-pointer shadow-sm hover:ring-2 hover:ring-[#24332C] transition-all ml-2"
            onClick={() => setIsProfileEditorOpen(true)}
          >
            <Image src={dashboardData?.artisanProfile?.photoUrl || "/female_artisan.jpg"} alt="Avatar" width={34} height={34} className="object-cover w-full h-full" />
          </div>

          <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors ml-2" title="Logout">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* IDENTITY STRIP - COMBINED OLD STYLE W/ NEW COMPACT STRUCTURE */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 px-6 gap-6">
          <div className="flex items-center gap-4">
            <div className="w-[52px] h-[52px] rounded-full overflow-hidden border-2 border-gray-100 shadow-sm shrink-0">
              <Image src={dashboardData?.artisanProfile?.photoUrl || "/female_artisan.jpg"} alt="Profile" width={52} height={52} className="object-cover w-full h-full" />
            </div>
            <div>
              <div className="text-[16px] font-bold text-gray-900 flex items-center flex-wrap gap-2">
                {dashboardData?.artisanName || 'Artisan'}
                <span className="inline-flex items-center bg-green-50 text-green-700 border border-green-200 text-[10.5px] font-bold px-2.5 py-0.5 rounded-full">
                  ✓ {t('verified_badge')}
                </span>
                {dashboardData?.artisanProfile?.giTagCertified && (
                  <span className="inline-flex items-center bg-orange-50 text-orange-700 border border-orange-200 text-[10.5px] font-bold px-2.5 py-0.5 rounded-full">
                    <Award size={10} className="mr-1" /> GI Tag
                  </span>
                )}
              </div>
              <div className="text-[13px] text-gray-500 mt-1 font-medium flex items-center gap-1">
                <MapPin size={12} /> {dashboardData?.artisanProfile?.clusterName || 'Local Cluster'} · {dashboardData?.artisanProfile?.craftType || 'Artisan'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:min-w-[260px] bg-gray-50 py-2 px-4 rounded-xl border border-gray-100">
            <span className="text-[12px] font-bold text-gray-500 whitespace-nowrap">{t('artisan_trust')}</span>
            <div className="flex-1 h-[6px] bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full ${healthScore >= 80 ? 'bg-[#3D624F]' : healthScore >= 50 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${healthScore}%` }}></div>
            </div>
            <span className={`text-[13px] font-bold ${healthScore >= 80 ? 'text-[#3D624F]' : healthScore >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
              {healthScore}%
            </span>
          </div>
        </div>

        
        {/* QUICK ACTIONS */}
        <div className="text-sm font-bold tracking-wider uppercase text-gray-500 mt-10 mb-6 px-2">
          {t('quick_actions')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr] gap-8">
          
          {/* Action 1 (Primary) */}
          <button 
            onClick={() => setIsModalOpen(true)}
            className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] relative transition-transform hover:-translate-y-1 group overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#24332C 0%, #14211B 100%)', boxShadow: '0 10px 25px -5px rgba(26,71,49,0.4)' }}
          >
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
            <span className="absolute top-6 right-6 bg-white/20 text-white text-[12px] font-bold tracking-wider px-4 py-1.5 rounded-full uppercase">
              {t('start_here')}
            </span>
            <div className="text-left relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center mb-6">
                <Camera size={24} className="text-white" />
              </div>
              <div className="text-xl font-bold text-white mb-2">{t('capture_new_craft')}</div>
              <div className="text-base text-white/80 leading-relaxed max-w-[85%]">
                {t('capture_subtitle')}
              </div>
            </div>
            <div className="mt-8 text-base font-bold text-white flex items-center gap-1 opacity-90 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
              Capture now <ArrowRightCircle size={20} className="ml-1" />
            </div>
          </button>

          {/* Action 2 */}
          <Link href="/artisan/schemes" className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 shadow-sm transition-all hover:-translate-y-1 hover:border-gray-300 hover:shadow-md group">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#24332C] flex items-center justify-center mb-6">
                <FileText size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('apply_for_schemes')}</div>
              <div className="text-base text-gray-500 leading-relaxed">
                {t('schemes_subtitle')}
              </div>
            </div>
            <div className="mt-8 text-base font-bold text-[#24332C] flex items-center group-hover:translate-x-1 transition-transform">
              {t('view_schemes')}
            </div>
          </Link>

          {/* Action 3 */}
          <Link href="/artisan/insights" className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 shadow-sm transition-all hover:-translate-y-1 hover:border-gray-300 hover:shadow-md group">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#24332C] flex items-center justify-center mb-6">
                <Globe size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('market_insights') || 'Market Insights'}</div>
              <div className="text-base text-gray-500 leading-relaxed">
                {t('market_insights_subtitle') || 'View real-time demand maps to find the best buyers for your craft.'}
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <ArrowRightCircle size={28} className="text-[#24332C] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>

          {/* Action 4 (Raw Materials) */}
          <Link href="/artisan/materials" className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 shadow-sm transition-all hover:-translate-y-1 hover:border-gray-300 hover:shadow-md group">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#24332C] flex items-center justify-center mb-6">
                <Package size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('raw_materials_title')}</div>
              <div className="text-base text-gray-500 leading-relaxed">{t('raw_materials_subtitle')}</div>
            </div>
            <div className="flex justify-end mt-4">
              <ArrowRightCircle size={28} className="text-[#24332C] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>

          {/* Action 5 (Learning AI) */}
          <button
            onClick={() => setIsLearningModalOpen(true)}
            className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 shadow-sm transition-all hover:-translate-y-1 hover:border-gray-300 hover:shadow-md group text-left"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#24332C] flex items-center justify-center mb-6">
                <GraduationCap size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('learn_ai_title')}</div>
              <div className="text-base text-gray-500 leading-relaxed">{t('learn_ai_subtitle')}</div>
            </div>
            <div className="flex justify-end mt-4">
              <ArrowRightCircle size={28} className="text-[#24332C] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>

          {/* Action 6 (Live News) */}
          <Link href="/artisan/news" className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 shadow-sm transition-all hover:-translate-y-1 hover:border-gray-300 hover:shadow-md group">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#24332C] flex items-center justify-center mb-6">
                <Newspaper size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('live_news_title')}</div>
              <div className="text-base text-gray-500 leading-relaxed">{t('live_news_subtitle')}</div>
            </div>
            <div className="flex justify-end mt-4">
              <ArrowRightCircle size={28} className="text-[#24332C] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>

        </div>

        {/* STATS */}
        <div className="text-xs font-bold tracking-wider uppercase text-gray-400 mt-10 mb-4 px-2">
          {t('overview')}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold">
              {t('my_captures')} <Package size={16} className="text-gray-400"/>
            </div>
            <div className="text-3xl font-bold text-gray-900 mt-3">{dashboardData?.myCapturesCount || '0'}</div>
            <div className="text-xs text-green-600 font-bold mt-2">+{dashboardData?.trends?.captures?.replace('+','') || '0'} this month</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold">
              {t('advances_received')} <Banknote size={16} className="text-gray-400"/>
            </div>
            <div className="text-3xl font-bold text-gray-900 mt-3">₹{dashboardData?.totalAdvances?.toLocaleString() || '0'}</div>
            <div className="text-xs text-green-600 font-bold mt-2">+{dashboardData?.trends?.advances?.replace('+','') || '0%'}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold">
              {t('items_sold')} <HandCoins size={16} className="text-gray-400"/>
            </div>
            <div className="text-3xl font-bold text-gray-900 mt-3">{dashboardData?.itemsSold || '0'}</div>
            <div className="text-xs text-green-600 font-bold mt-2">+{dashboardData?.trends?.sold?.replace('+','') || '0'} this month</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold">
              {t('total_earnings')} <TrendingUp size={16} className="text-gray-400"/>
            </div>
            <div className="text-3xl font-bold text-gray-900 mt-3">₹{dashboardData?.totalEarnings?.toLocaleString() || '0'}</div>
            <div className="text-xs text-green-600 font-bold mt-2">+{dashboardData?.trends?.earnings?.replace('+','') || '0%'}</div>
          </div>
        </div>


        {/* LIVE EARNINGS & DIRECT UPI SETTLEMENT TRACKER
            Read-only. No admin or facilitator can release, hold or redirect any
            of these amounts: both tranches are written by the escrow engine on
            a dispatch/delivery trigger, straight to the artisan's own VPA. */}
        <div className="text-xs font-bold tracking-wider uppercase text-gray-400 mt-10 mb-4 px-2">
          Live Earnings &amp; Direct UPI Settlement Tracker
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Total Gross Sales"
              value={formatRupees(dashboardData?.totalGrossSales ?? 0)}
              icon={<TrendingUp size={18} />}
              accentColor="teal"
            />
            <StatCard
              label="40% Instant Advances Received"
              value={formatRupees(dashboardData?.advancesReceived ?? 0)}
              icon={<Banknote size={18} />}
              accentColor="blue"
            />
            <StatCard
              label="Final Settlements Cleared"
              value={formatRupees(dashboardData?.finalSettlementsCleared ?? 0)}
              icon={<HandCoins size={18} />}
              accentColor="brown"
            />
          </div>

          {dashboardData?.upiId ? (
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-[var(--color-sage)] bg-[var(--color-mint)] px-4 py-3">
              <span className="text-sm font-bold text-primary">
                🟢 Direct to VPA: {dashboardData.upiId} — Zero Middleman Intervention
              </span>
              <span className="sm:ml-auto text-[11px] font-bold text-primary/70 whitespace-nowrap">
                Programmatic settlement (test)
              </span>
            </div>
          ) : (
            <button
              onClick={() => setIsProfileEditorOpen(true)}
              className="mt-5 w-full text-left rounded-xl border border-dashed border-[var(--color-sage)] bg-[var(--color-mint)]/40 px-4 py-3 text-sm font-bold text-primary hover:bg-[var(--color-mint)] transition-colors"
            >
              Add your UPI ID so settlements can reach you directly — tap to add it to your profile.
            </button>
          )}

          <p className="text-[11px] text-gray-500 italic mt-4 leading-relaxed">
            Prototype: Stripe runs in TEST mode and real UPI payout rails are not wired, so each
            tranche is recorded as a programmatic settlement (test) — direct to your VPA, zero
            middleman. The escrow states and the audit trail are real; the bank credit is simulated.
          </p>
        </div>

        {/* LISTINGS */}
        <div className="text-xs font-bold tracking-wider uppercase text-gray-400 mt-10 mb-4 px-2">
          {t('my_uploaded_works')}
        </div>
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4 px-2">
          <div>
            <h3 className="font-bold text-xl text-gray-900">{t('table_subtitle')}</h3>
            <p className="text-sm text-gray-500 mt-1 font-medium">{dashboardData?.myCapturesCount || '0'} total captures · {dashboardData?.itemsSold || '0'} sold</p>
          </div>
          <button className="border border-gray-200 bg-white px-5 py-2 rounded-xl text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors">
            {t('view_all')}
          </button>
        </div>

        {listNotice && (
          <div
            className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold border ${
              listNotice.tone === 'ok'
                ? 'bg-[var(--color-mint)] border-[var(--color-sage)] text-primary'
                : 'bg-orange-50 border-orange-200 text-orange-800'
            }`}
          >
            {listNotice.text}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto shadow-sm">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-gray-500 text-xs font-bold tracking-wider uppercase py-4 px-6 border-b border-gray-200">{t('craft_details')}</th>
                <th className="text-gray-500 text-xs font-bold tracking-wider uppercase py-4 px-6 border-b border-gray-200">{t('blockchain_patch_id')}</th>
                <th className="text-gray-500 text-xs font-bold tracking-wider uppercase py-4 px-6 border-b border-gray-200">{t('date')}</th>
                <th className="text-gray-500 text-xs font-bold tracking-wider uppercase py-4 px-6 border-b border-gray-200">{t('status')}</th>
                <th className="text-gray-500 text-xs font-bold tracking-wider uppercase py-4 px-6 border-b border-gray-200">{t('action')}</th>
              </tr>
            </thead>
            <tbody>
              {dashboardData?.recentCaptures?.length > 0 ? (
                dashboardData.recentCaptures.map((item: any, i: number) => {
                  let statusClass = "bg-gray-100 text-gray-600"; // Minted/default
                  if (item.status === 'PENDING_VERIFICATION') statusClass = "bg-orange-50 text-orange-600"; // Pending
                  if (item.status === 'SOLD_FINAL' || item.status === 'SOLD_MIDDLEMAN' || item.isListedOnMarketplace) statusClass = "bg-green-50 text-green-700"; // Listed/Sold
                  if (item.status === 'FLAGGED') statusClass = "bg-red-50 text-red-600";
                  // Approved and patch minted, but the artisan still has to
                  // stick it on and re-photograph the piece. Amber: action due.
                  if (item.status === 'VERIFIED' && !item.qrVerified) statusClass = "bg-yellow-50 text-yellow-700";
                  // Patch attached and AI-matched - ready to list.
                  if (item.status === 'SELLABLE') statusClass = "bg-[var(--color-mint)] text-primary";
                  // Voice drafts are not "pending" anything yet — they are
                  // waiting on the artisan, so they get their own mint chip.
                  const isIvrDraft = item.status === 'IVR_DRAFT';
                  if (isIvrDraft) statusClass = "bg-[var(--color-mint)] text-primary";

                  const awaitingPatch = item.status === 'VERIFIED' && !item.qrVerified && item.patchId;
                  
                  return (
                    <tr key={item.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors">
                      <td className="py-5 px-6">
                        <div className="font-bold text-sm text-gray-900">{item.craftType}</div>
                        <div className="text-xs text-gray-500 mt-1 truncate max-w-[200px]">{item.descriptionEnglish}</div>
                      </td>
                      <td className="py-5 px-6 text-xs font-medium">
                        {item.status === 'PENDING_VERIFICATION' ? (
                          <span className="text-gray-400 italic">Hidden pending verification</span>
                        ) : (
                          <span className="text-gray-500 font-mono">{item.patchId || `#ITM-${item.id.substring(0,6).toUpperCase()}`}</span>
                        )}
                      </td>
                      <td className="py-5 px-6 text-sm text-gray-700 font-medium">
                        {new Date(item.createdAt).toLocaleDateString('en-GB', {day: '2-digit', month: '2-digit', year: 'numeric'}).replace(/\//g, ' · ')}
                      </td>
                      <td className="py-5 px-6">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${statusClass}`}>
                          {isIvrDraft
                            ? t('ivr_draft')
                            : t(item.status.toLowerCase()) !== item.status.toLowerCase() ? t(item.status.toLowerCase()) : item.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-5 px-6">
                        {/* Wraps on narrow screens so the listing action and the
                            existing details/draft action both stay reachable. */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          {!isIvrDraft && (
                            awaitingPatch ? (
                              <button
                                onClick={() => setQrItem(item)}
                                className="inline-flex items-center gap-1.5 bg-primary text-white font-bold text-xs px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors"
                              >
                                <QrCode size={13} /> {t('download_qr_upload_photo')}
                              </button>
                            ) : item.isListedOnMarketplace ? (
                              <span className="inline-flex items-center gap-1.5 bg-[var(--color-mint)] text-primary font-bold text-xs px-3 py-2 rounded-lg">
                                <CheckCircle2 size={13} /> {t('listed_on_ondc')}
                              </span>
                            ) : (
                              <button
                                onClick={() => listOnOndc(item)}
                                disabled={listingId === item.id}
                                className="inline-flex items-center gap-1.5 border border-[var(--color-sage)] text-primary font-bold text-xs px-3 py-2 rounded-lg hover:bg-[var(--color-mint)] disabled:opacity-50 transition-colors"
                              >
                                {listingId === item.id
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <Globe2 size={13} />}
                                {t('list_on_ondc')}
                              </button>
                            )
                          )}

                          {isIvrDraft ? (
                            <button
                              onClick={() => setDraftItem(item)}
                              className="bg-primary text-white font-bold text-xs px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors"
                            >
                              {t('complete_draft')}
                            </button>
                          ) : (
                            <button
                              onClick={() => { setSelectedItem(item); setIsDetailsModalOpen(true); }}
                              className="text-[#24332C] font-bold text-sm hover:underline whitespace-nowrap"
                            >
                              {t('view_details')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 px-6 text-center text-gray-500 text-sm font-medium">{t('table_no_data')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      {/* MODALS
          Each is mounted only while it is open. `dynamic()` fetches a chunk when
          the component RENDERS, so leaving them mounted with isOpen={false}
          would download every modal on first paint and defeat the split. */}
      {isModalOpen && <CaptureModal isOpen onClose={handleModalClose} />}

      {(isSellModalOpen || isCrossCheckModalOpen) && (
        <AgentHandoffModal
          isOpen
          onClose={() => { setIsSellModalOpen(false); setIsCrossCheckModalOpen(false); fetchDashboardData(); }}
          item={selectedItem}
        />
      )}

      {isDisputeModalOpen && (
        <DisputeModal isOpen onClose={() => setIsDisputeModalOpen(false)} item={selectedDisputeItem} />
      )}

      {isProfileEditorOpen && (
        <ProfileEditorModal
          isOpen
          onClose={() => setIsProfileEditorOpen(false)}
          artisanData={{...dashboardData?.artisanProfile, name: dashboardData?.artisanName}}
          onSaved={fetchDashboardData}
        />
      )}

      {isLearningModalOpen && (
        <LearningAssistantModal
          isOpen
          onClose={() => setIsLearningModalOpen(false)}
          /* The artisan's real craft, so the assistant asks about — and finds
             videos for — what they actually make. */
          craftType={dashboardData?.artisanProfile?.craftType}
        />
      )}

      {qrItem !== null && (
        <QrAttachModal
          isOpen
          onClose={() => setQrItem(null)}
          item={qrItem}
          onVerified={fetchDashboardData}
        />
      )}

      {draftItem && (
        <CompleteDraftModal
          item={draftItem}
          onClose={() => setDraftItem(null)}
          onCompleted={() => {
            setDraftItem(null);
            fetchDashboardData();
          }}
        />
      )}

      {isDetailsModalOpen && selectedItem && (
        <DetailsModal item={selectedItem} onClose={() => { setIsDetailsModalOpen(false); setSelectedItem(null); }} />
      )}
    </div>
  );
}

/**
 * What the artisan has actually been paid on one item, driven off `status`.
 *
 * An advance only becomes real in `disbursement/apply`, i.e. after an admin has
 * verified the item AND the artisan has claimed it. Every status before that
 * must read zero. The AI `fairWageFloor` is a valuation, so it may only ever be
 * shown as an *eligible* amount, never as money received.
 */
function describeArtisanMoney(item: any, t: (key: string) => string) {
  const advancePaid = Number(item?.advancePaid) || 0;
  const finalPayout = Number(item?.finalPayoutQueued) || 0;
  const eligible = Number(item?.fairWageFloor) || 0;
  const helperWith = (key: string, amount: number) =>
    t(key).replace('{amount}', formatRupees(amount));

  switch (String(item?.status || '')) {
    case 'PENDING_VERIFICATION':
      return {
        label: t('advance_received'),
        value: formatRupees(0),
        helper: helperWith('advance_helper_pending', eligible),
        received: false,
      };
    case 'VERIFIED':
    case 'TAG_ATTACHED':
      return {
        label: t('advance_received'),
        value: formatRupees(0),
        helper: helperWith('advance_helper_verified', eligible),
        received: false,
      };
    case 'SOLD_FINAL':
    case 'PAYOUT_COMPLETED':
      return {
        label: t('total_earned'),
        value: formatRupees(advancePaid + finalPayout),
        helper: `${t('advance_received')} ${formatRupees(advancePaid)} · ${t('final_payout')} ${formatRupees(finalPayout)}`,
        received: advancePaid + finalPayout > 0,
      };
    case 'SOLD_MIDDLEMAN':
      return {
        label: t('advance_received'),
        value: formatRupees(advancePaid),
        helper: t('advance_helper_middleman'),
        received: advancePaid > 0,
      };
    case 'LISTED_AUCTION':
      return {
        label: t('advance_received'),
        value: formatRupees(advancePaid),
        helper: t('advance_helper_auction'),
        received: advancePaid > 0,
      };
    default:
      // ADVANCE_PAID and anything later: the row's own number is the truth.
      return {
        label: t('advance_received'),
        value: formatRupees(advancePaid),
        helper: advancePaid > 0 ? null : helperWith('advance_helper_verified', eligible),
        received: advancePaid > 0,
      };
  }
}

function DetailsModal({ item, onClose }: { item: any, onClose: () => void }) {
  const { t } = useLanguage();
  const money = describeArtisanMoney(item, t);
  const listingPrice = getListingPrice(item);

  /**
   * The photo and the timeline are deliberately NOT in the dashboard payload —
   * they were the bulk of it. Fetch them here, for this one item, when the
   * artisan actually opens it.
   */
  const [detail, setDetail] = useState<{
    images: string[];
    auditLogs: any[];
    patchId: string | null;
    qrVerified: boolean;
    qrVerifiedImageUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!item?.id) return;
    let cancelled = false;
    const kickoff = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items/${item.id}`, { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && data?.success) {
          setDetail({
            images: data.images || [],
            auditLogs: data.auditLogs || [],
            patchId: data.patchId ?? null,
            qrVerified: data.qrVerified === true,
            qrVerifiedImageUrl: data.qrVerifiedImageUrl ?? null,
          });
        }
      } catch (e) {
        console.error('Failed to load item details:', e);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, [item?.id]);

  const heroImage = detail?.images?.[0] || item.images?.[0] || "/ikat_saree.jpg";
  const timeline = detail?.auditLogs ?? item.auditLogs ?? null;
  /** The photo the artisan took of the piece with its printed QR patch on it. */
  const patchPhoto = detail?.qrVerified ? detail.qrVerifiedImageUrl : null;
  const patchId = detail?.patchId ?? item.patchId ?? null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in-up">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="font-serif font-bold text-lg text-[#24332C]">{t('transaction_details')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[80vh]">
          <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden mb-6 bg-gray-100 border border-gray-200 shadow-sm">
            {/* Data URLs cannot be optimized by next/image, so skip the
                optimizer for them and keep it for the static fallback. */}
            <Image
              src={heroImage}
              alt="Item"
              fill
              sizes="(max-width: 640px) 100vw, 512px"
              unoptimized={heroImage.startsWith('data:')}
              className="object-cover"
            />
            <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold shadow-sm">
              {item.status === 'PENDING_VERIFICATION' ? 'ID Hidden' : `ID: ${item.patchId || item.id.substring(0,8).toUpperCase()}`}
            </div>
          </div>

          {/* The physical-patch proof. This is the photo the artisan took of the
              finished piece with its printed QR stuck on, which the AI matched
              against the original capture before the item became sellable —
              deliberately a different picture from the hero image above. */}
          {patchPhoto && (
            <div className="mb-6">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {t('verification_photo_title')}
                </h4>
                <span className="inline-flex items-center gap-1 bg-[var(--color-mint)] text-primary text-[10px] font-bold px-2.5 py-1 rounded-full border border-[var(--color-sage)]">
                  <CheckCircle2 size={11} /> {t('verified_authentic')}
                </span>
              </div>

              <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-gray-100 border border-[var(--color-sage)] shadow-sm">
                <Image
                  src={patchPhoto}
                  alt={t('verification_photo_title')}
                  fill
                  sizes="(max-width: 640px) 100vw, 512px"
                  /* Real uploads arrive as data URLs, seeded ones as /seed paths.
                     Only the former cannot go through the optimizer. */
                  unoptimized={patchPhoto.startsWith('data:')}
                  className="object-cover"
                />
              </div>

              {patchId && (
                <p className="text-[11px] font-mono text-gray-500 mt-2">{patchId}</p>
              )}
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                {t('verification_photo_note')}
              </p>
            </div>
          )}

          <h3 className="text-xl font-bold text-gray-900 mb-1">{item.craftType}</h3>
          <p className="text-gray-600 text-sm mb-6">{item.descriptionEnglish}</p>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">{t('status')}</span>
              <span className="font-medium text-gray-800">{item.status.replace(/_/g, ' ')}</span>
            </div>
            <div className={`p-4 rounded-xl border ${money.received ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
              <span className={`text-xs font-bold uppercase tracking-wider block mb-1 ${money.received ? 'text-green-600' : 'text-gray-400'}`}>{money.label}</span>
              <span className={`font-bold text-xl ${money.received ? 'text-green-700' : 'text-gray-500'}`}>{money.value}</span>
            </div>
          </div>

          {money.helper && (
            <p className="-mt-4 mb-6 text-xs text-gray-500 leading-relaxed">{money.helper}</p>
          )}
          
          <div className="space-y-3">
            <div className="flex justify-between text-sm py-2 border-b border-gray-100">
              <span className="text-gray-500">{t('your_listing_price')}</span>
              <span className="font-bold text-gray-900">{formatRupees(listingPrice)}</span>
            </div>
            <div className="flex justify-between text-sm py-2 border-b border-gray-100">
              <span className="text-gray-500">{t('total_valuation_band')}</span>
              <span className="font-medium">₹{item.marketPriceMin?.toLocaleString()} - ₹{item.marketPriceMax?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm py-2 border-b border-gray-100">
              <span className="text-gray-500">{t('labor_days')}</span>
              <span className="font-medium">{item.laborDays} {t('days')}</span>
            </div>
            <div className="flex justify-between text-sm py-2">
              <span className="text-gray-500">{t('material_cost')}</span>
              <span className="font-medium">₹{item.rawMaterialCost?.toLocaleString()}</span>
            </div>
          </div>

          {/* Product Timeline — the same audit chain the public passport shows */}
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h4 className="font-bold text-base text-gray-900 mb-5 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <Clock size={16} />
              </span>
              {t('product_timeline')}
            </h4>

            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
              {timeline && timeline.length > 0 ? (
                timeline.map((log: any) => (
                  <div key={log.id} className="relative flex items-start gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-white bg-blue-100 text-blue-500 shrink-0 shadow-sm relative z-10">
                      <CheckCircle2 size={14} />
                    </div>
                    <div className="flex-1 min-w-0 p-4 rounded-xl border border-gray-100 bg-gray-50 shadow-sm">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-sm text-gray-900">
                          {log.action.replace(/_/g, ' ')}
                        </span>
                        {log.actorRole && (
                          <span className="text-[10px] uppercase font-bold text-gray-400 bg-gray-200 px-2 py-0.5 rounded shrink-0">
                            {log.actorRole}
                          </span>
                        )}
                      </div>
                      <time className="text-xs font-medium text-blue-500 mb-2 block">
                        {new Date(log.createdAt).toLocaleDateString()} · {new Date(log.createdAt).toLocaleTimeString()}
                      </time>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        {log.comments || `State updated to ${log.newState?.status || 'Unknown'}`}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-sm text-gray-500 italic py-4">
                  {t('no_timeline_events')}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-full transition-colors">
            {t('close_btn')}
          </button>
        </div>
      </div>
    
          </div>
  );
}