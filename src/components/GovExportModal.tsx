"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Download, FileJson, FileSpreadsheet, Info, Loader2, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import type { GemGuidance } from "@/lib/gemGuidance";

/**
 * Export the artisan's verified crafts as government-marketplace catalogs.
 *
 * Neither GeM nor ONDC exposes a public seller push API, so this deliberately
 * produces files the artisan uploads themselves. The copy says so rather than
 * implying a submission has happened.
 */

interface ExportState {
  count: number;
  empty: boolean;
  guidance: GemGuidance | null;
}

export function GovExportModal({
  isOpen,
  onClose,
  artisanId,
}: {
  isOpen: boolean;
  onClose: () => void;
  artisanId: string | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();

  const [state, setState] = useState<ExportState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * A flag rather than a translated string: `useLanguage()` returns a fresh `t`
   * on every render, so depending on it inside the loader's useCallback made
   * the effect re-subscribe endlessly and cancel its own pending fetch. The
   * message is translated at render time instead.
   */
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [countRes, guideRes] = await Promise.all([
        fetch("/api/artisan/gem-export?format=count", { cache: "no-store" }),
        fetch("/api/artisan/gem-export?format=guidance", { cache: "no-store" }),
      ]);

      if (countRes.status === 401 || countRes.status === 403) {
        router.push("/login");
        return;
      }

      const countData = await countRes.json();
      const guideData = await guideRes.json();

      setState({
        count: countData?.count ?? 0,
        empty: Boolean(countData?.empty) || (countData?.count ?? 0) === 0,
        guidance: guideData?.guidance ?? null,
      });
    } catch (e) {
      console.error("Export preflight failed:", e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isOpen) return;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [isOpen, load]);

  /**
   * Downloads go through a Blob rather than navigation: these endpoints require
   * the auth cookie and return attachments, and window.open would lose the
   * error path entirely.
   */
  const download = async (url: string, filename: string, key: string) => {
    setBusy(key);
    setFailed(false);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(`Export failed with ${res.status}`);

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error("Download failed:", e);
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  const empty = state?.empty ?? false;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-gray-100 sticky top-0 bg-card z-10">
          <div className="min-w-0">
            <h2 className="text-xl font-serif font-bold text-primary flex items-center gap-2">
              <Building2 size={20} /> {t("gov_export_title")}
            </h2>
            <p className="text-xs text-gray-500 mt-1">{t("gov_export_subtitle")}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label={t("close_btn")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {loading ? (
            <p className="text-sm text-gray-500 py-8 text-center flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> {t("gov_export_preparing")}
            </p>
          ) : empty ? (
            <div className="text-center py-6">
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">{t("gov_export_empty")}</p>
              <Link
                href="/artisan/market"
                className="inline-block bg-primary text-white px-5 py-2.5 rounded-xl font-bold hover:bg-primary-dark transition-colors text-sm"
              >
                {t("gov_export_empty_cta")}
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-primary bg-[var(--color-mint)] border border-[var(--color-sage)]/40 rounded-xl px-4 py-3">
                {t("gov_export_count").replace("{n}", String(state?.count ?? 0))}
              </p>

              <div className="space-y-2">
                {[
                  {
                    key: "csv",
                    label: t("gov_export_download_csv"),
                    icon: <FileSpreadsheet size={16} />,
                    url: "/api/artisan/gem-export?format=csv",
                    filename: "karigari-gem-catalog.csv",
                    primary: true,
                  },
                  {
                    key: "json",
                    label: t("gov_export_download_json"),
                    icon: <FileJson size={16} />,
                    url: "/api/artisan/gem-export?format=json",
                    filename: "karigari-gem-catalog.json",
                  },
                  {
                    key: "ondc",
                    label: t("gov_export_download_ondc"),
                    icon: <Download size={16} />,
                    url: artisanId
                      ? `/api/ondc/catalog?artisanId=${encodeURIComponent(artisanId)}`
                      : "/api/ondc/catalog",
                    filename: "karigari-ondc-beckn.json",
                  },
                ].map((entry) => (
                  <button
                    key={entry.key}
                    onClick={() => download(entry.url, entry.filename, entry.key)}
                    disabled={busy !== null}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-50",
                      entry.primary
                        ? "bg-primary text-white hover:bg-primary-dark"
                        : "bg-white border border-[var(--color-sage)] text-primary hover:bg-[var(--color-mint)]"
                    )}
                  >
                    {busy === entry.key ? <Loader2 size={16} className="animate-spin" /> : entry.icon}
                    {entry.label}
                  </button>
                ))}
              </div>

              {/* Tax fields are the seller's liability — never presented as final. */}
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex gap-2 items-start">
                <Info size={14} className="shrink-0 mt-0.5" />
                {t("gov_export_hsn_note")}
              </p>

              {state?.guidance && (
                <div className="border-t border-gray-100 pt-5">
                  <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-1">
                    {t("gov_export_guide")}
                  </h3>
                  <p className="text-sm font-bold text-gray-800 mb-1">{state.guidance.title}</p>
                  {/* One chip per reservation: SC/ST and Womaniya stack. */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {(state.guidance.preferences ?? [
                      { key: state.guidance.preference, label: state.guidance.preferenceLabel },
                    ]).map((p) => (
                      <span
                        key={p.key}
                        className="inline-block text-[11px] font-bold bg-[var(--color-mint)] text-primary px-2 py-1 rounded-full"
                      >
                        {p.label}
                      </span>
                    ))}
                  </div>

                  <ol className="space-y-3">
                    {state.guidance.steps.map((step) => (
                      <li key={step.number} className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-[var(--color-mint)] text-primary text-xs font-bold flex items-center justify-center shrink-0">
                          {step.number}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-800">{step.title}</p>
                          <p className="text-xs text-gray-500 leading-relaxed">{step.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <p className="text-[11px] text-gray-400 italic mt-4 leading-relaxed">
                    {state.guidance.disclaimer}
                  </p>
                </div>
              )}
            </>
          )}

          {failed && (
            <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {t("gov_export_failed")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
