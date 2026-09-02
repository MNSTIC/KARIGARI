import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, RefreshCw, Smartphone } from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";

/**
 * The service worker's document fallback.
 *
 * Served when a navigation misses both the network and the page cache — a cold
 * launch onto a route the artisan has never opened while online. It has to be a
 * static server component with no data of its own, because by definition
 * nothing can be fetched when it renders.
 */
export const metadata: Metadata = {
  title: "Offline — KARIGARI",
  description: "You are offline. Anything you captured is safe on your phone.",
};

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center">
        <KarigariLogo variant="dark" showWordmark={true} size={28} />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-card border border-gray-200 rounded-2xl shadow-card p-7 sm:p-9 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-mint)] text-primary flex items-center justify-center mx-auto mb-6">
            <CloudOff size={32} />
          </div>

          <h1 className="text-2xl font-serif font-bold text-primary mb-3">
            You&rsquo;re offline
          </h1>
          <p className="text-sm text-gray-600 leading-relaxed mb-6">
            This page needs a connection. Nothing you have already saved is lost —
            captures made without signal stay on your phone and upload
            automatically the moment you are back online.
          </p>

          <div className="rounded-xl border border-[var(--color-sage)]/60 bg-[var(--color-mint)]/50 p-4 text-left flex gap-2.5 items-start mb-6">
            <Smartphone size={16} className="shrink-0 mt-0.5 text-primary" />
            <p className="text-xs text-primary leading-relaxed">
              Open your dashboard to keep capturing. New crafts are queued on this
              device and sent as soon as there is a network.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/artisan/dashboard"
              className="flex-1 bg-primary hover:bg-primary-dark text-white px-5 py-3 rounded-xl font-bold text-sm min-h-[44px] flex items-center justify-center transition-colors"
            >
              Go to my dashboard
            </Link>
            {/* A plain link back to itself: the service worker retries the
                network on a fresh navigation, so this is the "try again" the
                page can honestly offer without any client JS. */}
            <Link
              href="/offline"
              className="flex-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 px-5 py-3 rounded-xl font-bold text-sm min-h-[44px] flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw size={15} /> Try again
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
