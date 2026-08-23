"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Map as MapIcon, TrendingUp, AlertTriangle, Info, MapPin, Package, CheckCircle2 } from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";

export default function InsightsPage() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/artisan/dashboard');
      const data = await res.json();
      if (data.success) {
        setProfile(data.data.artisanProfile);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const craft = profile?.craftType || "Ikat Weaving";

  const [newDemandAppeared, setNewDemandAppeared] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNewDemandAppeared(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-20">
      <header className="px-4 py-4 bg-white shadow-sm sticky top-0 z-40 flex items-center gap-3">
        <Link href="/artisan/dashboard" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Market Insights</h1>
          <p className="text-xs text-gray-500 font-medium">View real-time demand maps</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        
        {/* Real-time B2B Demand Map */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Live Demand Map</h2>
              <p className="text-gray-500 text-sm">Viewing AI-aggregated B2B matching signals for <strong className="text-[#1A4731]">{craft}</strong>.</p>
            </div>
            {newDemandAppeared && (
              <div className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1.5 rounded-full animate-bounce">
                New Buyer Demand Listed!
              </div>
            )}
          </div>
          
          {/* Map Container */}
          <div className="relative w-full aspect-video bg-[#E8EAED] rounded-xl border border-gray-200 overflow-hidden shadow-inner">
            {/* Realistic Map Background (OpenStreetMap) */}
            <div className="absolute inset-0 z-0">
              <iframe 
                width="100%" 
                height="100%" 
                frameBorder="0" 
                scrolling="no" 
                marginHeight={0} 
                marginWidth={0} 
                src="https://www.openstreetmap.org/export/embed.html?bbox=68.1%2C7.9%2C97.3%2C35.5&amp;layer=mapnik" 
                style={{ filter: 'grayscale(0.3) brightness(1.1) hue-rotate(10deg)', opacity: 0.8 }}
                className="pointer-events-none"
              ></iframe>
            </div>
            
            {/* Overlay shadow for depth */}
            <div className="absolute inset-0 z-0 shadow-inner bg-gradient-to-b from-transparent to-[#E8EAED]/50 pointer-events-none"></div>
            
            {/* Dynamic New Demand (Delhi) */}
            {newDemandAppeared && (
              <div className="absolute top-[26%] left-[40%] group cursor-pointer animate-fade-in-up z-30">
                <div className="w-12 h-12 bg-blue-500 rounded-full animate-ping absolute opacity-50 -left-4 -top-4"></div>
                <div className="relative z-10 w-4 h-4 bg-blue-600 border-[3px] border-white rounded-full shadow-lg"></div>
                
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-blue-200 w-64 transition-opacity pointer-events-none z-20 overflow-hidden">
                  <div className="bg-blue-600 px-3 py-2">
                    <div className="font-bold text-sm text-white flex items-center justify-between">
                      Delhi NCR <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">JUST NOW</span>
                    </div>
                  </div>
                  <div className="p-3 bg-white">
                    <div className="text-xs font-bold text-gray-500 uppercase mb-1">New B2B Request</div>
                    <div className="font-bold text-gray-900 mb-2">50 Sambalpuri Sarees (Diwali)</div>
                    <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg">
                      <span className="text-xs font-bold text-gray-600">Offered Price</span>
                      <span className="text-sm font-bold text-[#1A4731]">₹3,800/unit</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
              
              {/* Mumbai Hotspot (High Demand) */}
              <div className="absolute top-[57%] left-[24%] group cursor-pointer">
                <div className="w-8 h-8 bg-red-500 rounded-full animate-ping absolute opacity-30 -left-2 -top-2"></div>
                <div className="relative z-10 w-4 h-4 bg-red-600 border-[3px] border-white rounded-full shadow-md"></div>
                
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-gray-100 w-56 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 border-b border-red-100">
                    <div className="font-bold text-sm text-red-900">Mumbai Zone</div>
                  </div>
                  <div className="p-3 bg-white">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Demand</span>
                      <span className="text-sm font-bold text-red-600">850 Units</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Available Supply</span>
                      <span className="text-sm font-bold text-gray-900">120 Units</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bangalore Hotspot (High Demand) */}
              <div className="absolute top-[74%] left-[37%] group cursor-pointer">
                <div className="w-8 h-8 bg-red-500 rounded-full animate-ping absolute opacity-30 -left-2 -top-2"></div>
                <div className="relative z-10 w-4 h-4 bg-red-600 border-[3px] border-white rounded-full shadow-md"></div>
                
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-gray-100 w-56 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 border-b border-red-100">
                    <div className="font-bold text-sm text-red-900">Bangalore Tech Park</div>
                  </div>
                  <div className="p-3 bg-white">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Demand</span>
                      <span className="text-sm font-bold text-red-600">420 Units</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Available Supply</span>
                      <span className="text-sm font-bold text-gray-900">50 Units</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Local Cluster (High Supply) */}
              <div className="absolute top-[50%] left-[70%] group cursor-pointer">
                <div className="relative z-10 w-4 h-4 bg-green-500 border-[3px] border-white rounded-full shadow-md"></div>
                
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-gray-100 w-56 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 overflow-hidden">
                  <div className="bg-green-50 px-3 py-2 border-b border-green-100">
                    <div className="font-bold text-sm text-green-900">Local Cluster Hub</div>
                  </div>
                  <div className="p-3 bg-white">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Demand</span>
                      <span className="text-sm font-bold text-gray-900">45 Units</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Available Supply</span>
                      <span className="text-sm font-bold text-green-600">890 Units</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            </div> {/* End Inner Map Wrapper */}
            </div> {/* End Outer Container */}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-6 px-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                <div className="w-3 h-3 bg-red-600 rounded-full"></div> High Demand Hotspot
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div> Saturated (High Supply)
              </div>
            </div>
        </div>

        {/* Right Column: AI Actionable Advice */}
        <div className="space-y-6">
          <div className="bg-[#0F2D20] text-white p-6 rounded-2xl shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
            
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2"><TrendingUp size={20}/> AI Recommendation</h3>
            <p className="text-sm text-white/80 mb-6 leading-relaxed">
              Based on the upcoming festive season, demand for <strong>{craft}</strong> in Metro Tier-1 cities (Delhi, Mumbai) is up 45%. 
              Local middlemen are currently paying below market value.
            </p>
            
            <div className="bg-white/10 p-4 rounded-xl border border-white/20 mb-6">
              <div className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">Suggested Action</div>
              <div className="text-sm font-bold">Hold current inventory and list directly on ONDC for B2C buyers.</div>
            </div>

            <Link href="/artisan/dashboard" className="block w-full bg-white text-[#0F2D20] text-center py-3 rounded-xl font-bold hover:bg-gray-100 transition-colors">
              List on ONDC
            </Link>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider">SMS Auto-Pilot</h3>
            <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm mb-4 border border-blue-100">
              <Info size={16} className="mb-2 inline-block mr-2" />
              <strong>No internet? No problem.</strong>
              <p className="mt-1 text-blue-700/80 text-xs">When demand spikes for your craft, we will send you an SMS. Just reply "YES" to automatically list your inventory at the best price.</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
              <CheckCircle2 size={16} className="text-green-500" /> WhatsApp / SMS Alerts Active
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
