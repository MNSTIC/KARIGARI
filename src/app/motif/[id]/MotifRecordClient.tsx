"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { fill } from "@/components/buyer/passportFormat";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { MotifDisclaimer } from "@/components/MotifDisclaimer";
import { MotifCard } from "@/components/motif/MotifCard";
import type { PublicMotif } from "@/lib/motifLicence";

/**
 * The record a brand reads, and the form they use to ask.
 *
 * The enquiry form collects what a cluster needs in order to answer — who is
 * asking, how to reach them, and what for — and nothing else. It never quotes a
 * price: no figure exists until a human in the village names one, and a
 * suggested fee on this page would become the price by default.
 *
 * The disclaimer is above the fold and again under the form, because this is the
 * page most likely to be screenshotted as though it were a registry entry.
 */
export function MotifRecordClient({ motif }: { motif: PublicMotif }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ licenseeName: "", licenseeContact: "", intendedUse: "", scope: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const complete = form.licenseeName.trim() && form.licenseeContact.trim() && form.intendedUse.trim();

  const submit = async () => {
    if (!complete) return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/motif/licence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motifId: motif.id, ...form }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setState("sent");
    } catch (submitError) {
      setError((submitError as Error)?.message || t("network_error_retry"));
      setState("idle");
    }
  };

  const field = (key: keyof typeof form, labelKey: string, rows = 1, max = 120) => (
    <label className="block">
      <span className="text-[13px] font-semibold text-gray-800">{t(labelKey)}</span>
      {rows > 1 ? (
        <textarea
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          rows={rows}
          maxLength={max}
          className="mt-1 w-full rounded-xl border border-gray-300 bg-card p-3 text-[15px] leading-relaxed"
        />
      ) : (
        <input
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          maxLength={max}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-card px-3 text-[15px]"
        />
      )}
    </label>
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="kg-display text-[32px] leading-tight text-gray-900 sm:text-[40px]">{motif.name}</h1>
          <p className="mt-1.5 text-[14px] text-gray-600">
            {fill(t("motif_held_by"), { cluster: motif.clusterName })}
          </p>
        </div>
        <LanguageSwitcher />
      </div>

      <MotifDisclaimer className="mb-6" />

      <MotifCard motif={motif} />

      <section className="mt-8" aria-label={t("motif_licence_request")}>
        <SectionEyebrow>{t("motif_licence_request")}</SectionEyebrow>

        {!motif.licensable ? (
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{t("motif_not_licensable")}</p>
        ) : state === "sent" ? (
          <Card pad="lg" radius="3xl" tone="muted" className="mt-3">
            <p className="text-[15px] leading-relaxed text-gray-800">{t("motif_licence_submitted")}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{t("motif_licence_submitted_note")}</p>
          </Card>
        ) : (
          <Card pad="lg" radius="3xl" className="mt-3">
            <p className="text-[14px] leading-relaxed text-gray-600">{t("motif_licence_intro")}</p>
            <div className="mt-4 space-y-3">
              {field("licenseeName", "motif_licence_name", 1, 80)}
              {field("licenseeContact", "motif_licence_contact", 1, 120)}
              {field("intendedUse", "motif_licence_use", 3, 400)}
              {field("scope", "motif_licence_scope", 1, 120)}
            </div>

            {error && <p className="mt-3 text-[13px] text-[var(--color-rust)]">{error}</p>}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!complete || state === "sending"}
              className="kg-press mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {state === "sending" ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Send size={15} aria-hidden />
              )}
              {t("motif_licence_send")}
            </button>
            <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{t("motif_licence_no_price")}</p>
          </Card>
        )}
      </section>

      <MotifDisclaimer tone="inline" className="mt-8" />
    </main>
  );
}
