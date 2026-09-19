"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, MapPin, Recycle, Users } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { fill, passportDay } from "@/components/buyer/passportFormat";
import { formatWeight, materialLabelKey, type ScrapMaterial } from "@/lib/scrap";

/**
 * Recording a scrap sale that actually happened.
 *
 * This is the only screen in the feature with a rupee field on it, and the
 * field is empty until a facilitator types what a recycler really paid. There
 * is no suggested figure, no estimate from the weight and no carried-over
 * "offer" from an enquiry: a recycler's opening offer is what they said, not
 * what the cluster agreed, and pre-filling it here would quietly make it the
 * settlement.
 *
 * What the split will do is stated before the button is pressed — pro rata by
 * the grams each artisan logged, to the rupee — so the person recording the
 * sale can see the rule rather than discover it afterwards.
 */

interface Enquiry {
  id: string;
  recyclerName: string;
  contact: string;
  offerRupees: number | null;
  message: string | null;
  createdAt: string;
}

interface AdminPool {
  id: string;
  material: ScrapMaterial;
  area: string | null;
  totalGrams: number;
  thresholdGrams: number;
  contributorCount: number;
  status: string;
  listedAt: string | null;
  soldAt: string | null;
  salePriceRupees: number | null;
  recyclerName: string | null;
  enquiryCount: number;
  shareCount: number;
  enquiries: Enquiry[];
}

export function ScrapSales({ onOpenCount }: { onOpenCount?: (count: number) => void }) {
  const { t } = useLanguage();
  const [pools, setPools] = useState<AdminPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { price: string; name: string; contact: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/scrap-sale", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setPools(data.pools ?? []);
      onOpenCount?.(data.openCount ?? 0);
    } catch (loadError) {
      setError((loadError as Error)?.message || "Could not load the scrap pools.");
    } finally {
      setLoading(false);
    }
    // `onOpenCount` is a parent setState and is stable in practice; including it
    // would re-run this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const formFor = (id: string) => forms[id] ?? { price: "", name: "", contact: "" };

  const recordSale = async (pool: AdminPool) => {
    const form = formFor(pool.id);
    const price = Number(form.price);
    if (!Number.isInteger(price) || price <= 0 || !form.name.trim() || !form.contact.trim()) return;

    setBusyId(pool.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/scrap-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId: pool.id,
          salePriceRupees: price,
          recyclerName: form.name,
          recyclerContact: form.contact,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      await load();
    } catch (saleError) {
      setError((saleError as Error)?.message || "Could not record that sale.");
    } finally {
      setBusyId(null);
    }
  };

  const weightText = (grams: number) => {
    const w = formatWeight(grams);
    return `${w.value} ${t(w.unitKey)}`;
  };

  if (loading) return <div className="kg-shimmer h-[160px] rounded-2xl" aria-hidden />;

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}

      {pools.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-gray-600">{t("scrap_admin_empty")}</p>
      ) : (
        <ul className="space-y-4">
          {pools.map((pool) => {
            const form = formFor(pool.id);
            const sold = pool.status === "SOLD";
            return (
              <li key={pool.id}>
                <Card pad="lg">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-gray-900">
                      <Recycle size={17} className="text-gray-500" aria-hidden />
                      {t(materialLabelKey(pool.material))}
                    </span>
                    <Badge variant={sold ? "info" : "success"}>
                      {t(sold ? "scrap_pool_status_sold" : "scrap_pool_status_listed")}
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-gray-600">
                    <span className="font-semibold text-gray-900">{weightText(pool.totalGrams)}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={13} aria-hidden />
                      {fill(t("scrap_pool_contributors"), { n: pool.contributorCount })}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={13} aria-hidden />
                      {pool.area ? fill(t("scrap_area"), { area: pool.area }) : t("scrap_area_withheld")}
                    </span>
                    {pool.listedAt && (
                      <span>{fill(t("scrap_listed_on"), { date: passportDay(pool.listedAt) })}</span>
                    )}
                  </div>

                  {pool.enquiries.length > 0 && (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <SectionEyebrow>
                        {pool.enquiryCount === 1
                          ? t("scrap_admin_enquiries_one")
                          : fill(t("scrap_admin_enquiries"), { n: pool.enquiryCount })}
                      </SectionEyebrow>
                      <ul className="mt-2 space-y-2">
                        {pool.enquiries.map((enquiry) => (
                          <li key={enquiry.id} className="text-[13px] leading-relaxed text-gray-700">
                            <span className="font-semibold">{enquiry.recyclerName}</span> · {enquiry.contact}
                            {/* Shown as what they SAID, never as the lot's price. */}
                            {enquiry.offerRupees !== null && (
                              <>
                                {" · "}
                                <span className="text-gray-600">
                                  {fill(t("scrap_admin_offer_said"), {
                                    amount: enquiry.offerRupees.toLocaleString("en-IN"),
                                  })}
                                </span>
                              </>
                            )}
                            {enquiry.message && <p className="text-gray-600">{enquiry.message}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {sold ? (
                    <p className="mt-4 border-t border-gray-100 pt-3 text-[13px] leading-relaxed text-gray-700">
                      {fill(t("scrap_admin_sold"), {
                        amount: (pool.salePriceRupees ?? 0).toLocaleString("en-IN"),
                        buyer: pool.recyclerName ?? "",
                        n: pool.shareCount,
                      })}
                    </p>
                  ) : (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <SectionEyebrow>{t("scrap_admin_record_sale")}</SectionEyebrow>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-500">
                        {t("scrap_admin_split_note")}
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <label className="block">
                          <span className="text-[12px] font-semibold text-gray-700">{t("scrap_admin_price")}</span>
                          <input
                            value={form.price}
                            onChange={(e) => setForms({ ...forms, [pool.id]: { ...form, price: e.target.value } })}
                            inputMode="numeric"
                            maxLength={9}
                            className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-card px-3 text-[14px]"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[12px] font-semibold text-gray-700">{t("scrap_admin_recycler")}</span>
                          <input
                            value={form.name}
                            onChange={(e) => setForms({ ...forms, [pool.id]: { ...form, name: e.target.value } })}
                            maxLength={120}
                            className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-card px-3 text-[14px]"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[12px] font-semibold text-gray-700">{t("scrap_admin_contact")}</span>
                          <input
                            value={form.contact}
                            onChange={(e) => setForms({ ...forms, [pool.id]: { ...form, contact: e.target.value } })}
                            maxLength={120}
                            className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-card px-3 text-[14px]"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => void recordSale(pool)}
                        disabled={
                          busyId === pool.id ||
                          !form.name.trim() ||
                          !form.contact.trim() ||
                          !Number.isInteger(Number(form.price)) ||
                          Number(form.price) <= 0
                        }
                        className="kg-press mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                      >
                        {busyId === pool.id ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                        ) : (
                          <Coins size={14} aria-hidden />
                        )}
                        {t("scrap_admin_distribute")}
                      </button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
