"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Phone, ExternalLink, ShieldCheck, Box, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export default function MaterialsPage() {
  const { t, language } = useLanguage();
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [craftName, setCraftName] = useState("Your Craft");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two strings, one tiny query — not the whole dashboard payload.
      const dbRes = await fetch('/api/artisan/profile-lite', { cache: 'no-store' });
      const dbData = await dbRes.json();

      const craftType = dbData?.craftType || "General Crafts";
      const clusterName = dbData?.clusterName || "Local Artisan Cluster";
      setCraftName(craftType);

      const res = await fetch('/api/artisan/generate-materials', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftType, clusterName, language })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        setMaterials(data.data);
      } else {
        // Never render a fabricated row: say plainly that nothing loaded.
        setMaterials([]);
        setError(data?.error || t('materials_load_failed'));
      }
    } catch (e) {
      console.error(e);
      setMaterials([]);
      setError(t('materials_load_failed'));
    } finally {
      setLoading(false);
    }
    // `t` is read inside but deliberately not a dependency: the fetch only
    // needs to re-run when the language changes, and listing it here would
    // re-create this callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(fetchData, 0);
    return () => clearTimeout(kickoff);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
          <Link href="/artisan/dashboard" className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors">
            <ArrowLeft size={20} className="text-gray-700" />
          </Link>
          <h1 className="font-serif font-bold text-xl text-gray-900">{t('materials_title')}</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-8 flex flex-col md:flex-row gap-6 items-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
            <Box size={32} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Verified Suppliers for {craftName}</h2>
            <p className="text-sm text-gray-600">Buy high-quality, authentic raw materials directly from government-approved suppliers. Buying verified materials improves your Karigari Trust Score.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p>Scanning local cooperatives and suppliers for {craftName} materials...</p>
          </div>
        ) : error ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <AlertTriangle size={28} className="mx-auto mb-3 text-gray-400" />
            <p className="font-bold text-gray-900 mb-1">{t('materials_load_failed')}</p>
            <p className="text-sm text-gray-500 mb-6">{error}</p>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
            >
              <RefreshCw size={16} /> {t('retry')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {materials.map((mat, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group p-5 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <h3 className="font-bold text-gray-900 text-lg leading-tight">{mat.name}</h3>
                    <span className="font-bold text-xl text-[#24332C] whitespace-nowrap">{mat.price}</span>
                  </div>
                  
                  <p className="text-sm text-gray-700 leading-relaxed mb-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                    {mat.description || "High-quality raw materials suitable for traditional craft making."}
                  </p>

                  <div className="text-sm font-bold text-gray-800 mb-1 flex items-center gap-2">
                    {mat.supplier}
                    {mat.isVerified !== false && (
                      <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider">
                        <ShieldCheck size={10} /> Verified
                      </span>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-2 text-xs font-medium text-gray-500 mb-6">
                    <span className="flex items-center gap-2"><MapPin size={14} className="text-gray-400"/> {mat.location}</span>
                    <span className="flex items-center gap-2"><Phone size={14} className="text-gray-400"/> {mat.contact || "Contact details hidden"}</span>
                  </div>
                </div>

                <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100">
                  <button className="flex-1 py-2.5 rounded-xl border border-gray-200 font-bold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                    <Phone size={16} /> Call Supplier
                  </button>
                  <button className="flex-1 py-2.5 rounded-xl bg-[#24332C] text-white font-bold hover:bg-[#1a2520] transition-colors flex items-center justify-center gap-2 shadow-md">
                    Order Now <ExternalLink size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
