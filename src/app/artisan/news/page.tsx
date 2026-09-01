"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Calendar, ExternalLink, Loader2, Newspaper, Megaphone, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export default function NewsPage() {
  const { t, language } = useLanguage();
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Raw RSS headlines the route hands back when the summariser is down. */
  const [headlines, setHeadlines] = useState<{ title: string; link: string }[]>([]);
  const [craftName, setCraftName] = useState("Your Craft");
  const [clusterName, setClusterName] = useState("Local Area");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two strings, one tiny query — not the whole dashboard payload.
      const dbRes = await fetch('/api/artisan/profile-lite', { cache: 'no-store' });
      const dbData = await dbRes.json();

      const craft = dbData?.craftType || "General Crafts";
      const cluster = dbData?.clusterName || "Local Artisan Cluster";
      setCraftName(craft);
      setClusterName(cluster);

      const res = await fetch('/api/artisan/generate-news', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ craftType: craft, clusterName: cluster, language })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        setNews(data.data);
        setHeadlines([]);
      } else {
        // No invented article. Show the real headlines if the route sent them.
        setNews([]);
        setHeadlines(Array.isArray(data?.headlines) ? data.headlines : []);
        setError(data?.error || t('news_load_failed'));
      }
    } catch (e) {
      console.error(e);
      setNews([]);
      setError(t('news_load_failed'));
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
          <h1 className="font-serif font-bold text-xl text-gray-900">{t('news_title')}</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-8 flex flex-col md:flex-row gap-6 items-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center shrink-0">
            <Newspaper size={32} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Live Updates for {craftName}</h2>
            <p className="text-sm text-gray-600">Stay updated on local artisan assemblies, government schemes, and market trends directly related to your work in {clusterName}.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p>Scanning the internet for local {craftName} updates...</p>
          </div>
        ) : error ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <AlertTriangle size={28} className="mx-auto mb-3 text-gray-400" />
            <p className="font-bold text-gray-900 mb-1">{t('news_load_failed')}</p>
            <p className="text-sm text-gray-500 mb-6">{error}</p>

            {headlines.length > 0 && (
              <div className="text-left max-w-lg mx-auto mb-6 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  {t('news_raw_headlines')}
                </p>
                {headlines.map((headline, i) => (
                  <a
                    key={i}
                    href={headline.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-primary hover:underline"
                  >
                    {headline.title}
                  </a>
                ))}
              </div>
            )}

            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors"
            >
              <RefreshCw size={16} /> {t('retry')}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {news.map((item, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow group flex flex-col md:flex-row gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                      item.type === 'EVENT' ? 'bg-orange-100 text-orange-700' :
                      item.type === 'GOVT_SCHEME' ? 'bg-blue-100 text-blue-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {item.type === 'EVENT' ? <Calendar size={12} className="inline mr-1"/> :
                       item.type === 'GOVT_SCHEME' ? <ShieldCheck size={12} className="inline mr-1"/> :
                       <Megaphone size={12} className="inline mr-1"/>}
                      {String(item.type || 'NEWS').replace('_', ' ')}
                    </span>
                    <span className="text-sm font-medium text-gray-500">{item.date}</span>
                  </div>
                  
                  <h3 className="font-bold text-gray-900 text-xl mb-2">{item.title}</h3>
                  <p className="text-gray-600 mb-4">{item.description}</p>
                  
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-gray-400 flex items-center gap-1">
                      <MapPin size={14} /> Source: {item.source}
                    </div>
                    {item.link ? (
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-[#24332C] font-bold text-sm flex items-center gap-1 hover:underline">
                        Read More <ExternalLink size={14} />
                      </a>
                    ) : (
                      <button className="text-[#24332C] font-bold text-sm flex items-center gap-1 hover:underline opacity-50 cursor-not-allowed" title="Link not available">
                        Read More <ExternalLink size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
