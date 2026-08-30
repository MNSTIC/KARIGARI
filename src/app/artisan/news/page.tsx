"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Calendar, ExternalLink, Loader2, Newspaper, Megaphone, Milestone, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

export default function NewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [craftName, setCraftName] = useState("Your Craft");
  const [clusterName, setClusterName] = useState("Local Area");

  useEffect(() => {
    async function fetchData() {
      try {
        const dbRes = await fetch('/api/artisan/dashboard');
        const dbData = await dbRes.json();
        
        const craft = dbData.data?.artisanProfile?.craftType || "General Crafts";
        const cluster = dbData.data?.artisanProfile?.clusterName || "Local Artisan Cluster";
        setCraftName(craft);
        setClusterName(cluster);

        const res = await fetch('/api/artisan/generate-news', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ craftType: craft, clusterName: cluster })
        });
        const data = await res.json();
        if (data.success && data.data) {
          setNews(data.data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
          <Link href="/artisan/dashboard" className="p-2 -ml-2 rounded-full hover:bg-gray-100 transition-colors">
            <ArrowLeft size={20} className="text-gray-700" />
          </Link>
          <h1 className="font-serif font-bold text-xl text-gray-900">Live News & Events</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-8 flex flex-col md:flex-row gap-6 items-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center shrink-0">
            <Newspaper size={32} className="text-green-600" />
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
                      {item.type.replace('_', ' ')}
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
