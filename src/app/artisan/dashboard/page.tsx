"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { 
  Bell, Globe, ChevronDown, TrendingUp, Package, HandCoins, Banknote, 
  LogOut, X, MapPin, Award, Camera, FileText, ArrowRightCircle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CaptureModal } from "@/components/CaptureModal";
import { AgentHandoffModal } from "@/components/AgentHandoffModal";
import { DisputeModal } from "@/components/DisputeModal";
import { ProfileEditorModal } from "@/components/ProfileEditorModal";
import { useLanguage } from "@/lib/translations";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { VoiceOnboarding } from "@/components/VoiceOnboarding";

export default function ArtisanDashboard() {
  const router = useRouter();
  const { t, language, changeLanguage } = useLanguage();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [isCrossCheckModalOpen, setIsCrossCheckModalOpen] = useState(false);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [isWhatsappSimOpen, setIsWhatsappSimOpen] = useState(false);
  
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedDisputeItem, setSelectedDisputeItem] = useState<any>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const fetchDashboardData = async () => {
    try {
      const res = await fetch('/api/artisan/dashboard', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setDashboardData(data.data);
      } else {
        if (data.status === 401 || data.status === 403) {
          router.push('/login');
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (e) {
      console.error(e);
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
          
          {/* Notifications */}
          <div className="relative">
            <button onClick={() => setShowNotifications(!showNotifications)} className="text-gray-500 hover:text-gray-900 transition-colors">
              <Bell size={20} />
              {flaggedItems.length > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white"></span>}
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-100 z-50">
                <div className="p-3 border-b border-gray-50"><h3 className="text-sm font-bold text-gray-900">Notifications</h3></div>
                {flaggedItems.length > 0 ? (
                  <div className="max-h-60 overflow-y-auto">
                    {flaggedItems.map((item: any) => (
                      <div key={item.id} className="p-3 border-b border-gray-50 hover:bg-red-50 cursor-pointer text-sm">
                        <p className="font-bold text-red-600 mb-1">Attention Required</p>
                        <p className="text-gray-700">Your item <strong>{item.craftType}</strong> was flagged.</p>
                      </div>
                    ))}
                  </div>
                ) : <div className="p-4 text-center text-sm text-gray-500">No new notifications.</div>}
              </div>
            )}
          </div>
          
          <Link href="/buyer" className="hidden sm:flex items-center justify-center bg-[#0F2D20] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#1A4731] transition-colors ml-2 shadow-sm border border-[#0F2D20]/50">
            Switch to Buyer View
          </Link>

          <div 
            className="w-[34px] h-[34px] rounded-full overflow-hidden border border-gray-200 cursor-pointer shadow-sm hover:ring-2 hover:ring-[#1A4731] transition-all ml-2"
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
              <div className={`h-full ${healthScore >= 80 ? 'bg-[#0D9488]' : healthScore >= 50 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${healthScore}%` }}></div>
            </div>
            <span className={`text-[13px] font-bold ${healthScore >= 80 ? 'text-[#0D9488]' : healthScore >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
              {healthScore}%
            </span>
          </div>
        </div>

        
        {/* WHATSAPP SIMULATOR BANNER */}
        <div className="mb-10 bg-gradient-to-r from-green-500 to-teal-600 rounded-2xl p-6 shadow-md text-white flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg mb-1">Demo: Offline SMS / WhatsApp Fallback</h3>
            <p className="text-white/80 text-sm">Show judges how artisans receive demand alerts via WhatsApp when offline.</p>
          </div>
          <button onClick={() => setIsWhatsappSimOpen(true)} className="bg-white text-green-700 font-bold px-6 py-3 rounded-xl shadow hover:bg-green-50 transition-colors whitespace-nowrap">
            Run Simulation
          </button>
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
            style={{ background: 'linear-gradient(135deg,#1A4731 0%, #0F2D20 100%)', boxShadow: '0 10px 25px -5px rgba(26,71,49,0.4)' }}
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
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#1A4731] flex items-center justify-center mb-6">
                <FileText size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('apply_for_schemes')}</div>
              <div className="text-base text-gray-500 leading-relaxed">
                {t('schemes_subtitle')}
              </div>
            </div>
            <div className="mt-8 text-base font-bold text-[#1A4731] flex items-center group-hover:translate-x-1 transition-transform">
              {t('view_schemes')}
            </div>
          </Link>

          {/* Action 3 */}
          <Link href="/artisan/insights" className="rounded-3xl p-8 flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 shadow-sm transition-all hover:-translate-y-1 hover:border-gray-300 hover:shadow-md group">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-[#1A4731] flex items-center justify-center mb-6">
                <Globe size={24} />
              </div>
              <div className="text-xl font-bold text-gray-900 mb-2">{t('market_insights') || 'Market Insights'}</div>
              <div className="text-base text-gray-500 leading-relaxed">
                {t('market_insights_subtitle') || 'View real-time demand maps to find the best buyers for your craft.'}
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <ArrowRightCircle size={28} className="text-[#1A4731] opacity-0 group-hover:opacity-100 transition-opacity" />
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
                          {t(item.status.toLowerCase()) !== item.status.toLowerCase() ? t(item.status.toLowerCase()) : item.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-5 px-6">
                        <button 
                          onClick={() => { setSelectedItem(item); setIsDetailsModalOpen(true); }}
                          className="text-[#1A4731] font-bold text-sm hover:underline"
                        >
                          {t('view_details')}
                        </button>
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

      {/* MODALS */}
      <CaptureModal isOpen={isModalOpen} onClose={handleModalClose} />
      <AgentHandoffModal 
        isOpen={isSellModalOpen || isCrossCheckModalOpen} 
        onClose={() => { setIsSellModalOpen(false); setIsCrossCheckModalOpen(false); fetchDashboardData(); }} 
        item={selectedItem} 
      />
      <DisputeModal isOpen={isDisputeModalOpen} onClose={() => setIsDisputeModalOpen(false)} item={selectedDisputeItem} />
      <ProfileEditorModal 
        isOpen={isProfileEditorOpen} 
        onClose={() => setIsProfileEditorOpen(false)} 
        artisanData={{...dashboardData?.artisanProfile, name: dashboardData?.artisanName}} 
        onSaved={fetchDashboardData} 
      />
      {isDetailsModalOpen && selectedItem && (
        <DetailsModal item={selectedItem} onClose={() => { setIsDetailsModalOpen(false); setSelectedItem(null); }} />
      )}
    </div>
  );
}

function DetailsModal({ item, onClose }: { item: any, onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in-up">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="font-serif font-bold text-lg text-[#1A4731]">{t('transaction_details')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[80vh]">
          <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden mb-6 bg-gray-100 border border-gray-200 shadow-sm">
            <Image src={item.images?.[0] || "/ikat_saree.jpg"} alt="Item" fill className="object-cover" />
            <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold shadow-sm">
              {item.status === 'PENDING_VERIFICATION' ? 'ID Hidden' : `ID: ${item.patchId || item.id.substring(0,8).toUpperCase()}`}
            </div>
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 mb-1">{item.craftType}</h3>
          <p className="text-gray-600 text-sm mb-6">{item.descriptionEnglish}</p>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">{t('status')}</span>
              <span className="font-medium text-gray-800">{item.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="bg-green-50 p-4 rounded-xl border border-green-100">
              <span className="text-xs text-green-600 font-bold uppercase tracking-wider block mb-1">{t('advance_received')}</span>
              <span className="font-bold text-xl text-green-700">₹{item.advancePaid > 0 ? item.advancePaid.toLocaleString() : (item.fairWageFloor?.toLocaleString() || 0)}</span>
            </div>
          </div>
          
          <div className="space-y-3">
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
        </div>
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-full transition-colors">
            {t('close_btn')}
          </button>
        </div>
      </div>
    
      {isWhatsappSimOpen && (
        <div id="whatsapp-simulator-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-[320px] h-[640px] shadow-2xl flex flex-col overflow-hidden relative border-[10px] border-gray-900">
            {/* Phone Header */}
            <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3 relative z-10 shadow">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center p-1 shrink-0 overflow-hidden">
                <img src="/icons/karigari-logo.png" alt="Karigari" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/WhatsApp.svg/512px-WhatsApp.svg.png'; }} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm leading-tight">KARIGARI Bot (Govt)</h3>
                <p className="text-[11px] text-white/80 leading-tight flex items-center gap-1">Official MoSJE Partner <CheckCircle2 size={10}/></p>
              </div>
              <button onClick={() => setIsWhatsappSimOpen(false)} className="bg-black/20 p-2 rounded-full hover:bg-black/40"><X size={16} /></button>
            </div>
            
            {/* WhatsApp Chat Background */}
            <div className="flex-1 bg-[#E5DDD5] p-4 flex flex-col gap-3 overflow-y-auto" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")' }}>
              <div className="text-center my-2"><span className="bg-[#E1F3FB] text-gray-600 text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-sm">Today</span></div>
              
              <div className="bg-white p-3 rounded-r-xl rounded-bl-xl max-w-[90%] shadow-sm relative">
                <p className="text-sm text-gray-900 leading-snug"><span role="img" aria-label="party">🎉</span> <strong>New Match for your Craft!</strong></p>
                <p className="text-sm text-gray-800 mt-2 leading-snug">
                  A buyer in Mumbai is looking for <strong>{dashboardData?.artisanProfile?.craftType || 'your craft item'}</strong>. 
                  They are offering <strong>&#8377;{dashboardData?.inventory?.[0]?.marketPriceMin || 4500}</strong>.
                </p>
                <p className="text-sm text-gray-800 mt-2 font-medium">Reply '1' to Accept</p>
                <p className="text-sm text-gray-800 font-medium">Reply '2' to Reject</p>
                <div className="text-[10px] text-gray-400 text-right mt-1">10:42 AM</div>
              </div>

              <div className="bg-[#DCF8C6] p-3 rounded-l-xl rounded-br-xl max-w-[80%] self-end shadow-sm relative mt-2">
                <p className="text-sm text-gray-900">1</p>
                <div className="text-[10px] text-gray-500 text-right mt-1 flex items-center justify-end gap-1">10:45 AM <CheckCircle2 size={12} className="text-[#34B7F1]"/></div>
              </div>

              <div className="bg-white p-3 rounded-r-xl rounded-bl-xl max-w-[90%] shadow-sm relative mt-2">
                <p className="text-sm text-gray-900 leading-snug"><span role="img" aria-label="check">✅</span> <strong>Order Confirmed!</strong></p>
                <p className="text-sm text-gray-800 mt-2 leading-snug">
                  The NGO facilitator has been notified to pick up the item tomorrow at 10 AM. 
                  Advance payment of <strong>&#8377;{Math.round((dashboardData?.inventory?.[0]?.marketPriceMin || 4500) * 0.4)}</strong> (40%) has been credited to your bank account via UPI.
                </p>
                <div className="text-[10px] text-gray-400 text-right mt-1">10:45 AM</div>
              </div>
            </div>
            
            {/* Phone Footer */}
            <div className="bg-[#F0F0F0] p-2 flex items-center gap-2">
              <div className="bg-white flex-1 rounded-full px-4 py-2.5 text-sm text-gray-400 border border-gray-200">Type a message</div>
              <div className="w-11 h-11 bg-[#00A884] rounded-full flex items-center justify-center text-white shrink-0 shadow-sm">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
