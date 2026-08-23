"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Globe, TrendingUp, Search, Package, ChevronRight, Store, DollarSign, CheckCircle2, MapPin } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import Image from "next/image";

export default function MarketPage() {
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState("ondc");
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/items/market')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setListings(data.items || []);
          setCurrentUserId(data.currentUserId);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const myListings = listings.filter(item => item.artisanId === currentUserId);
  const otherListings = listings.filter(item => item.artisanId !== currentUserId);

  // Fallback mocks if DB is empty
  const mockB2B = [
    { title: "Corporate Diwali Hampers", qty: "500 Units", price: "₹4,500/unit", buyer: "Tech Corp India" },
    { title: "Hotel Lobby Decor Sets", qty: "50 Units", price: "₹12,000/set", buyer: "Taj Group" }
  ];

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-12">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/artisan/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-gray-700"/>
          </Link>
          <KarigariLogo variant="dark" showWordmark={true} size={28} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-bold text-[#0F2D20] flex items-center gap-3">
            <Globe size={28} className="text-[#1A4731]" />
            ONDC & B2B Market
          </h1>
          <p className="text-gray-600 mt-2 text-sm sm:text-base">
            View live listings on the Open Network for Digital Commerce and connect directly with bulk buyers.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 sm:gap-4 mb-8 border-b border-gray-200 pb-1 overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setActiveTab("ondc")}
            className={`py-3 px-6 rounded-t-xl font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeTab === 'ondc' ? 'bg-[#0F2D20] text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
          >
            <Store size={18} /> Live ONDC Listings
          </button>
          <button 
            onClick={() => setActiveTab("b2b")}
            className={`py-3 px-6 rounded-t-xl font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeTab === 'b2b' ? 'bg-[#0F2D20] text-white shadow-md' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
          >
            <Package size={18} /> B2B Bulk Requests
          </button>
        </div>

        {loading ? (
          <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0F2D20]"></div></div>
        ) : (
          <div>
            {activeTab === 'ondc' && (
              <div className="space-y-10">
                {/* MY LISTINGS SECTION */}
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2 flex items-center gap-2">
                    <CheckCircle2 className="text-green-600"/> My Active Listings
                  </h2>
                  
                  {myListings.length === 0 ? (
                    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-2xl p-8 text-center">
                      <p className="text-gray-500 mb-4">You haven't listed any products on ONDC yet.</p>
                      <Link href="/artisan/dashboard" className="bg-[#1A4731] text-white px-6 py-2 rounded-lg font-bold">
                        Capture a Craft to List
                      </Link>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {myListings.map(item => (
                        <div key={item.id} className="bg-white rounded-2xl border border-green-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-all">
                          <div className="h-48 bg-gray-100 relative">
                            {item.images?.[0] ? (
                              <Image src={item.images[0]} fill alt={item.craftType} className="object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400"><Package size={40}/></div>
                            )}
                            <div className="absolute top-2 right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow">ONDC LIVE</div>
                          </div>
                          <div className="p-5 flex flex-col flex-1">
                            <h3 className="font-bold text-lg text-gray-900 mb-1 line-clamp-1">{item.descriptionEnglish || item.craftType}</h3>
                            <div className="text-xs text-gray-500 mb-4 flex items-center gap-1"><Store size={12}/> Listed by You</div>
                            
                            <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                              <span className="text-[#0F2D20] font-bold text-lg">₹{item.marketPriceMin || item.standardMarketPrice || 'N/A'}</span>
                              <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded">Edit Listing</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* OTHER LISTINGS SECTION */}
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2">
                    Other Artisan Listings in your Cluster
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {otherListings.length === 0 ? (
                      <p className="text-gray-500 italic">No other listings in this network.</p>
                    ) : (
                      otherListings.map(item => (
                        <div key={item.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                          <div className="h-48 bg-gray-100 relative">
                            {item.images?.[0] ? (
                              <Image src={item.images[0]} fill alt={item.craftType} className="object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400"><Package size={40}/></div>
                            )}
                          </div>
                          <div className="p-5 flex flex-col flex-1">
                            <h3 className="font-bold text-lg text-gray-900 mb-1 line-clamp-1">{item.descriptionEnglish || item.craftType}</h3>
                            <div className="text-xs text-gray-500 mb-4 flex items-center gap-1"><MapPin size={12}/> {item.artisan?.clusterName || 'Artisan Cluster'}</div>
                            
                            <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                              <span className="text-[#0F2D20] font-bold text-lg">₹{item.marketPriceMin || item.standardMarketPrice || 'N/A'}</span>
                              <span className="text-gray-400 text-xs">View</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'b2b' && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl text-blue-800 text-sm mb-6 flex gap-3">
                  <TrendingUp size={20} className="shrink-0" />
                  <p>These are bulk orders requested directly by businesses. Using your Karigari escrow wallet, you can safely accept these and get a 40% advance payment.</p>
                </div>
                {mockB2B.map((b2b, idx) => (
                  <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div>
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Buyer: {b2b.buyer}</div>
                      <h3 className="font-bold text-lg text-gray-900 mb-2">{b2b.title}</h3>
                      <div className="flex gap-3">
                        <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-1 rounded-md">Req: {b2b.qty}</span>
                        <span className="bg-[#E6F4EA] text-[#1A4731] text-xs font-bold px-2 py-1 rounded-md">Est. {b2b.price}</span>
                      </div>
                    </div>
                    <button className="bg-[#0F2D20] text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-[#1A4731] transition-colors whitespace-nowrap">
                      Submit Bid
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
