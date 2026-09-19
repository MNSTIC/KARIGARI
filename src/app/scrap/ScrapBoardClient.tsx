"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, Recycle, Send, Users } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { fill, passportDay } from "@/components/buyer/passportFormat";
import { formatWeight, materialLabelKey, type PublicScrapPool, type ScrapMaterial } from "@/lib/scrap";

/**
 * What a recycler sees, and the form they use to ask.
 *
 * Three things this page deliberately does not have:
 *
 *   · **A price.** Not an estimate, not a range, not a "worth about". A lot has
 *     no figure until a village names one in a real conversation, and a number
 *     printed here would become the price by default.
 *   · **A name.** No artisan's, no group's. The payload does not carry them.
 *   · **An address.** `publicAreaLabel` gives the coarsest area the platform
 *     can honestly stand behind — district and state at the most precise — and
 *     says nothing at all when even that would be a guess. Publishing where a
 *     group of low-income people keep saleable material is a real risk to them
 *     and is not worth a recycler's convenience.
 *
 * The enquiry goes through the platform, which is also why none of the above
 * costs anybody a deal: the cluster gets the message and answers directly.
 */
export function ScrapBoardClient() {
  const { t } = useLanguage();
  const [pools, setPools] = useState<PublicScrapPool[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ recyclerName: "", contact: "", offerRupees: "", message: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Deferred a macrotask so the effect body performs no synchronous setState.
    const kickoff = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/scrap/pools", { cache: "no-store" });
          const data = await res.json();
          if (!res.ok || !data?.success) throw new Error(`pools ${res.status}`);
          if (!cancelled) setPools(data.pools ?? []);
        } catch (loadError) {
          console.warn("[scrap board] unavailable:", (loadError as Error)?.message);
          if (!cancelled) setFailed(true);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
  }, []);

  const weightText = (grams: number) => {
    const w = formatWeight(grams);
    return `${w.value} ${t(w.unitKey)}`;
  };

  const submit = async (poolId: string) => {
    if (!form.recyclerName.trim() || !form.contact.trim()) return;
    setState("sending");
    setError(null);
    try {
      const offer = Number(form.offerRupees);
      const res = await fetch("/api/scrap/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId,
          recyclerName: form.recyclerName,
          contact: form.contact,
          // Optional. What the recycler said they would pay — never the lot's
          // price, and never shown back to anybody as one.
          offerRupees: Number.isInteger(offer) && offer > 0 ? offer : null,
          message: form.message,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setState("sent");
    } catch (submitError) {
      setError((submitError as Error)?.message || t("network_error_retry"));
      setState("idle");
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="kg-display text-[32px] leading-tight text-gray-900 sm:text-[40px]">
            {t("scrap_public_title")}
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-gray-600">{t("scrap_public_lede")}</p>
        </div>
        <LanguageSwitcher />
      </div>

      <Card pad="lg" radius="3xl" tone="muted" className="mb-6">
        <p className="text-[13px] leading-relaxed text-gray-700">{t("scrap_self_reported")}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-700">{t("scrap_threshold_note")}</p>
      </Card>

      {pools === null && !failed && (
        <div className="kg-shimmer h-[160px] rounded-2xl" aria-hidden />
      )}

      {failed && <p className="text-[14px] text-gray-600">{t("scrap_load_failed")}</p>}

      {pools !== null && pools.length === 0 && (
        <Card pad="lg" radius="3xl" className="border-dashed">
          <p className="text-[14px] leading-relaxed text-gray-600">{t("scrap_board_empty")}</p>
        </Card>
      )}

      {pools !== null && pools.length > 0 && (
        <ul className="space-y-4">
          {pools.map((pool) => (
            <li key={pool.id}>
              <Card pad="lg" radius="3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-[17px] font-semibold text-gray-900">
                    <Recycle size={18} className="text-gray-500" aria-hidden />
                    {t(materialLabelKey(pool.material as ScrapMaterial))}
                  </span>
                  <Badge variant="success">{t("scrap_pool_status_listed")}</Badge>
                </div>

                <p className="mt-2 text-[24px] font-bold leading-none text-gray-900">
                  {weightText(pool.totalGrams)}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={14} aria-hidden />
                    {/* Null is not a missing value here — it is the platform
                        refusing to name a place it cannot describe coarsely. */}
                    {pool.area ? fill(t("scrap_area"), { area: pool.area }) : t("scrap_area_withheld")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users size={14} aria-hidden />
                    {fill(t("scrap_pool_contributors"), { n: pool.contributorCount })}
                  </span>
                  <span>{fill(t("scrap_listed_on"), { date: passportDay(pool.listedAt) })}</span>
                </div>

                <p className="mt-3 text-[12px] leading-relaxed text-gray-500">{t("scrap_price_not_set")}</p>

                {state === "sent" && openId === pool.id ? (
                  <Card pad="md" tone="muted" className="mt-4">
                    <p className="text-[14px] leading-relaxed text-gray-800">{t("scrap_enquiry_sent")}</p>
                  </Card>
                ) : openId === pool.id ? (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <SectionEyebrow>{t("scrap_enquiry_cta")}</SectionEyebrow>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">{t("scrap_enquiry_note")}</p>
                    <div className="mt-3 space-y-3">
                      <label className="block">
                        <span className="text-[13px] font-semibold text-gray-800">{t("scrap_enquiry_name")}</span>
                        <input
                          value={form.recyclerName}
                          onChange={(e) => setForm({ ...form, recyclerName: e.target.value })}
                          maxLength={80}
                          className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-card px-3 text-[15px]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[13px] font-semibold text-gray-800">{t("scrap_enquiry_contact")}</span>
                        <input
                          value={form.contact}
                          onChange={(e) => setForm({ ...form, contact: e.target.value })}
                          maxLength={120}
                          className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-card px-3 text-[15px]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[13px] font-semibold text-gray-800">{t("scrap_enquiry_offer")}</span>
                        <input
                          value={form.offerRupees}
                          onChange={(e) => setForm({ ...form, offerRupees: e.target.value })}
                          inputMode="numeric"
                          maxLength={9}
                          className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-card px-3 text-[15px]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[13px] font-semibold text-gray-800">{t("scrap_enquiry_message")}</span>
                        <textarea
                          value={form.message}
                          onChange={(e) => setForm({ ...form, message: e.target.value })}
                          rows={3}
                          maxLength={400}
                          className="mt-1 w-full rounded-xl border border-gray-300 bg-card p-3 text-[15px] leading-relaxed"
                        />
                      </label>
                    </div>

                    {error && <p className="mt-3 text-[13px] text-[var(--color-rust)]">{error}</p>}

                    <button
                      type="button"
                      onClick={() => void submit(pool.id)}
                      disabled={state === "sending" || !form.recyclerName.trim() || !form.contact.trim()}
                      className="kg-press mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-white disabled:opacity-50"
                    >
                      {state === "sending" ? (
                        <Loader2 size={15} className="animate-spin" aria-hidden />
                      ) : (
                        <Send size={15} aria-hidden />
                      )}
                      {t("scrap_enquiry_submit")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(pool.id);
                      setState("idle");
                      setError(null);
                    }}
                    className="kg-press mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-card px-4 text-[14px] font-semibold text-gray-800"
                  >
                    <Send size={15} aria-hidden /> {t("scrap_enquiry_cta")}
                  </button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
