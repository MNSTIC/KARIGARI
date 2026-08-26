"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ClipboardCopy, Download, ExternalLink, Info, CheckCircle2, Wand2 } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Application auto-fill assistant.
 *
 * KARIGARI cannot submit to a government portal and never claims to. What it
 * can do is fill the form out of the artisan's stored profile, let them correct
 * it, and hand them a copyable/downloadable sheet so the real submission on the
 * official portal is typing-free.
 */

export interface AssistantScheme {
  key: string;
  name: string;
  benefit: string;
  officialUrl: string;
  formPath?: string;
}

export interface AssistantProfile {
  name?: string | null;
  craftType?: string | null;
  location?: string | null;
  socialCategory?: string | null;
  annualIncome?: number | null;
  aadhaarLast4?: string | null;
  upiId?: string | null;
  clusterName?: string | null;
  cooperativeId?: string | null;
  mobileNumber?: string | null;
}

interface Field {
  id: string;
  label: string;
  value: string;
  /** True when the value came from the stored profile rather than being left blank. */
  prefilled: boolean;
  hint?: string;
}

/** Fields the official form asks for that KARIGARI does not store. */
const SCHEME_EXTRA_FIELDS: Record<string, { id: string; label: string; hint?: string }[]> = {
  pm_vishwakarma: [
    { id: "trade", label: "Notified trade applied under" },
    { id: "family_trade", label: "Traditional family trade (Yes / No)" },
    { id: "bank_account", label: "Bank account number for the toolkit e-voucher" },
  ],
  nsfdc: [
    { id: "caste_certificate", label: "Caste certificate number" },
    { id: "sca", label: "State Channelizing Agency" },
    { id: "loan_amount", label: "Loan amount sought (₹)" },
    { id: "loan_purpose", label: "Purpose of the loan" },
  ],
  nbcfdc: [
    { id: "caste_certificate", label: "OBC certificate number" },
    { id: "sca", label: "State Channelizing Agency" },
    { id: "loan_amount", label: "Loan amount sought (₹)" },
    { id: "loan_purpose", label: "Purpose of the loan" },
  ],
  gem_seller: [
    { id: "firm_name", label: "Business / firm name" },
    { id: "pan", label: "PAN" },
    { id: "gstin", label: "GSTIN (or exemption claimed)" },
    { id: "bank_account", label: "Bank account number for settlements" },
  ],
  ahvy: [
    { id: "group_size", label: "Number of artisans in the group / SHG" },
    { id: "artisan_card", label: "Handicraft Artisan ID card number" },
    { id: "proposal", label: "Cluster proposal / activity planned" },
  ],
  ondc: [
    { id: "seller_category", label: "Seller category" },
    { id: "pickup_address", label: "Pickup address for logistics" },
    { id: "gstin", label: "GSTIN (or CGST §9(5) exemption)" },
  ],
};

export function SchemeFormAssistant({
  scheme,
  profile,
  onClose,
}: {
  scheme: AssistantScheme | null;
  profile: AssistantProfile | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  /** Only what the artisan typed over; the rest is derived from their profile. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<string | null>(scheme?.key ?? null);
  const [copied, setCopied] = useState(false);

  const initialFields = useMemo<Field[]>(() => {
    if (!scheme) return [];

    const base: Field[] = [
      { id: "name", label: "Applicant name", value: profile?.name || "", prefilled: !!profile?.name },
      {
        id: "mobile",
        label: "Mobile number",
        value: profile?.mobileNumber || "",
        prefilled: !!profile?.mobileNumber,
      },
      {
        id: "aadhaar",
        label: "Aadhaar number",
        value: profile?.aadhaarLast4 ? `XXXX XXXX ${profile.aadhaarLast4}` : "",
        prefilled: !!profile?.aadhaarLast4,
        // Only the last four digits are stored, so the artisan completes it on
        // the portal — KARIGARI never holds a full Aadhaar number.
        hint: "Only the last 4 digits are stored. Type the full number on the portal.",
      },
      {
        id: "category",
        label: "Social category",
        value: profile?.socialCategory || "",
        prefilled: !!profile?.socialCategory,
      },
      {
        id: "income",
        label: "Annual family income (₹)",
        value: profile?.annualIncome ? String(profile.annualIncome) : "",
        prefilled: !!profile?.annualIncome,
      },
      {
        id: "craft",
        label: "Craft / trade",
        value: profile?.craftType || "",
        prefilled: !!profile?.craftType,
      },
      {
        id: "cluster",
        label: "Cluster / cooperative",
        value: profile?.clusterName || profile?.cooperativeId || "",
        prefilled: !!(profile?.clusterName || profile?.cooperativeId),
      },
      {
        id: "address",
        label: "Address / district",
        value: profile?.location || "",
        prefilled: !!profile?.location,
      },
      { id: "upi", label: "UPI ID", value: profile?.upiId || "", prefilled: !!profile?.upiId },
    ];

    const extras = (SCHEME_EXTRA_FIELDS[scheme.key] || []).map((f) => ({
      id: f.id,
      label: f.label,
      value: "",
      prefilled: false,
      hint: f.hint,
    }));

    return [...base, ...extras];
  }, [scheme, profile]);

  // Reset during render (the React-recommended way) rather than in an effect,
  // so opening a different scheme never shows the previous one's edits.
  if ((scheme?.key ?? null) !== openedFor) {
    setOpenedFor(scheme?.key ?? null);
    setEdits({});
    setCopied(false);
  }

  const fields: Field[] = initialFields.map((field) =>
    edits[field.id] !== undefined ? { ...field, value: edits[field.id] } : field
  );

  useEffect(() => {
    if (!scheme) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheme, onClose]);

  if (!scheme) return null;

  const filledCount = fields.filter((f) => f.value.trim()).length;

  const asText = () =>
    [
      `${scheme.name} — application details`,
      `Prepared in KARIGARI on ${new Date().toLocaleDateString()}`,
      `Submit on: ${scheme.officialUrl}`,
      "",
      ...fields.map((f) => `${f.label}: ${f.value.trim() || "(to be filled)"}`),
      "",
      "KARIGARI did not submit this application. Copy these details into the official portal.",
    ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.error("Clipboard write failed", e);
    }
  };

  const download = () => {
    const blob = new Blob([asText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `karigari-${scheme.key}-application.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const update = (id: string, value: string) =>
    setEdits((prev) => ({ ...prev, [id]: value }));

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("scheme_assistant_title")}
    >
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] animate-fade-in-up">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-4 bg-gray-50 rounded-t-3xl shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-[var(--color-mint)] text-primary flex items-center justify-center shrink-0">
              <Wand2 size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="font-serif font-bold text-lg text-primary truncate">
                {t("scheme_assistant_title")}
              </h2>
              <p className="text-xs text-gray-500 truncate">{scheme.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 shrink-0"
            aria-label={t("close_btn")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-[var(--color-mint)] border border-[var(--color-sage)]/50 text-primary text-xs p-3 rounded-xl flex items-start gap-2">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p className="leading-relaxed">{t("scheme_assistant_intro")}</p>
          </div>

          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {filledCount}/{fields.length} {t("fields_ready")}
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            {fields.map((field) => (
              <div key={field.id}>
                <label
                  htmlFor={`assist-${field.id}`}
                  className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5"
                >
                  {field.label}
                  {field.prefilled && (
                    <span className="text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded normal-case tracking-normal">
                      {t("from_your_profile")}
                    </span>
                  )}
                </label>
                <input
                  id={`assist-${field.id}`}
                  value={field.value}
                  onChange={(e) => update(field.id, e.target.value)}
                  placeholder={t("you_fill_this")}
                  className={cn(
                    "w-full border rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all",
                    field.value.trim()
                      ? "bg-gray-50 border-gray-200"
                      : "bg-yellow-50 border-yellow-200"
                  )}
                />
                {field.hint && (
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{field.hint}</p>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-3 leading-relaxed">
            {t("scheme_assistant_honesty")}
          </p>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-3xl flex flex-wrap justify-end gap-3 shrink-0">
          <button
            onClick={copy}
            className="px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 font-bold rounded-xl transition-colors flex items-center gap-2 text-sm"
          >
            {copied ? <CheckCircle2 size={16} className="text-green-600" /> : <ClipboardCopy size={16} />}
            {copied ? t("copied") : t("copy_details")}
          </button>
          <button
            onClick={download}
            className="px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 font-bold rounded-xl transition-colors flex items-center gap-2 text-sm"
          >
            <Download size={16} /> {t("download_filled_form")}
          </button>
          <a
            href={scheme.formPath || scheme.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-primary hover:bg-primary-dark text-white font-bold rounded-xl transition-colors flex items-center gap-2 text-sm"
          >
            <ExternalLink size={16} /> {t("open_official_portal")}
          </a>
        </div>
      </div>
    </div>
  );
}
