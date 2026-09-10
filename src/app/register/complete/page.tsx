"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Fingerprint, Loader2 } from "lucide-react";
import { GENDERS, GENDER_LABELS } from "@/lib/gender";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Finish a Google sign-up.
 *
 * Google gives us a verified email, a name and a picture. It cannot give us
 * craftType, location, experienceYears, aadhaarLast4, annualIncome or gender —
 * six fields an artisan account is not usable without — so a Google sign-up
 * cannot be one hop, and this is the second one.
 *
 * The identity was verified against Google's own signature in the callback and
 * is held in a short-lived signed httpOnly cookie. This screen never sees it
 * except as the name and avatar the server renders back; the email is read-only
 * because it is not ours to change.
 *
 * The fields and their validation are the register page's, and the server runs
 * them through the SAME `validateSignup()` the password route uses — two
 * screens creating accounts with two copies of the rules would drift.
 */

const INPUT =
  "min-h-[52px] w-full rounded-xl border border-gray-300 bg-white px-4 text-[15px] text-gray-900 outline-none transition-colors focus:border-[var(--color-maroon)]";

const LABEL = "mb-1.5 block text-[13px] font-semibold text-gray-700";

interface Pending {
  email: string;
  name: string;
  picture: string | null;
}

export default function CompleteSignupPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [pending, setPending] = useState<Pending | null>(null);
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState<"ARTISAN" | "ADMIN">("ARTISAN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Shown after the account exists, so a passkey has something to attach to. */
  const [created, setCreated] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyDone, setPasskeyDone] = useState(false);

  const [form, setForm] = useState({
    name: "",
    craftType: "Ikat",
    location: "",
    experienceYears: "",
    aadhaarLast4: "",
    annualIncome: "",
    clusterName: "",
    gender: "",
  });

  // Deferred by a macrotask so the effect body performs no synchronous
  // setState — the same kickoff pattern the rest of this app uses.
  useEffect(() => {
    const kickoff = setTimeout(async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("role");
        if (requested === "ADMIN") setRole("ADMIN");

        const res = await fetch("/api/auth/google/pending", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          // The cookie expired or was never set. Back to the start rather than
          // an empty form that cannot submit.
          router.replace("/login?notice=google_state");
          return;
        }
        setPending(data.pending);
        setForm((prev) => ({ ...prev, name: data.pending.name || "" }));
      } catch {
        router.replace("/login?notice=google_failed");
      } finally {
        setChecking(false);
      }
    }, 0);
    return () => clearTimeout(kickoff);
  }, [router]);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/google/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, role }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || t("auth_complete_failed"));
        return;
      }
      // The account exists and the session is issued. Offer the passkey step
      // rather than navigating away — this is the one moment the person is
      // already here and already signed in.
      setCreated(true);
    } catch {
      setError(t("network_error_retry"));
    } finally {
      setLoading(false);
    }
  };

  const addPasskey = async () => {
    setPasskeyBusy(true);
    setError("");
    try {
      const optionsRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok || !optionsData?.success) {
        setError(optionsData?.error || t("passkey_failed"));
        return;
      }

      const { startRegistration } = await import("@simplewebauthn/browser");
      const attestation = await startRegistration({ optionsJSON: optionsData.options });

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result?.success) {
        setError(result?.error || t("passkey_failed"));
        return;
      }
      setPasskeyDone(true);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") {
        console.error("Passkey setup failed:", e);
        setError(t("passkey_failed"));
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const goToDashboard = () => {
    router.push(role === "ADMIN" ? "/admin/dashboard" : "/artisan/dashboard");
    router.refresh();
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!pending) return null;

  return (
    <div className="min-h-screen bg-[var(--color-background)] px-4 py-10">
      <div className="mx-auto w-full max-w-[520px] rounded-3xl bg-white p-6 shadow-card sm:p-8">
        {/* Who Google says this is. The email is read-only: it is not ours. */}
        <div className="flex items-center gap-4">
          {pending.picture ? (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--color-pill)]">
              <Image
                src={pending.picture}
                alt=""
                fill
                sizes="56px"
                unoptimized
                className="object-cover"
              />
            </div>
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-pill)] text-lg font-bold text-gray-600">
              {(pending.name || pending.email).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="kg-display truncate text-[24px] leading-tight text-gray-900">
              {t("auth_complete_title")}
            </h1>
            <p className="truncate text-[13px] text-gray-500">{pending.email}</p>
          </div>
        </div>

        {created ? (
          /* ---- The optional passkey step, after the account exists ---- */
          <div className="mt-8">
            <p className="text-[15px] leading-relaxed text-gray-700">
              {passkeyDone ? t("passkey_added") : t("passkey_offer_body")}
            </p>

            {error && (
              <p role="alert" className="mt-4 text-[13px] font-medium text-red-600">
                {error}
              </p>
            )}

            <div className="mt-6 space-y-3">
              {!passkeyDone && (
                <button
                  type="button"
                  onClick={() => void addPasskey()}
                  disabled={passkeyBusy}
                  className={cn(
                    "kg-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gray-100 text-[15px] font-semibold text-gray-800 hover:bg-gray-200",
                    passkeyBusy && "cursor-not-allowed opacity-60"
                  )}
                >
                  {passkeyBusy ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Fingerprint size={17} />
                  )}
                  {t("passkey_add_cta")}
                </button>
              )}
              {/* Skipping is a real, equal choice — not a greyed-out afterthought. */}
              <button
                type="button"
                onClick={goToDashboard}
                className="kg-press flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--color-maroon)] text-[15px] font-semibold text-[#F0A48C] hover:bg-[#6B2020]"
              >
                {passkeyDone ? t("continue_btn") : t("passkey_skip")}
              </button>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={submit}>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
              >
                {error}
              </p>
            )}

            <div>
              <label className={LABEL} htmlFor="complete-name">
                {t("full_name")}
              </label>
              <input
                id="complete-name"
                className={INPUT}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </div>

            <fieldset>
              <legend className={LABEL}>{t("auth_role_label")}</legend>
              <div role="radiogroup" aria-label={t("auth_role_label")} className="flex gap-2">
                {(["ARTISAN", "ADMIN"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={role === option}
                    onClick={() => setRole(option)}
                    className={cn(
                      "kg-press min-h-[52px] flex-1 rounded-xl border text-[14px] font-semibold transition-colors",
                      role === option
                        ? "border-[var(--color-maroon)] bg-[var(--color-pill)] text-gray-900"
                        : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                    )}
                  >
                    {option === "ARTISAN" ? t("artisan") : t("admin")}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* The six fields Google cannot supply. Artisan only — an admin
                account has no profile to fill in. */}
            {role === "ARTISAN" && (
              <>
                <div>
                  <label className={LABEL} htmlFor="complete-craft">
                    {t("craft_type")}
                  </label>
                  <input
                    id="complete-craft"
                    className={INPUT}
                    value={form.craftType}
                    onChange={(e) => set("craftType", e.target.value)}
                  />
                </div>

                <div>
                  <label className={LABEL} htmlFor="complete-gender">
                    {t("gender")}
                  </label>
                  <select
                    id="complete-gender"
                    required
                    className={cn(INPUT, "appearance-none")}
                    value={form.gender}
                    onChange={(e) => set("gender", e.target.value)}
                  >
                    <option value="" disabled>
                      {t("gender_select")}
                    </option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {GENDER_LABELS[g]}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">{t("gender_why")}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL} htmlFor="complete-location">
                      {t("location")}
                    </label>
                    <input
                      id="complete-location"
                      className={INPUT}
                      value={form.location}
                      onChange={(e) => set("location", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="complete-experience">
                      {t("experience_years")}
                    </label>
                    <input
                      id="complete-experience"
                      type="number"
                      min={0}
                      required
                      className={INPUT}
                      value={form.experienceYears}
                      onChange={(e) => set("experienceYears", e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL} htmlFor="complete-aadhaar">
                      {t("aadhaar_last4")}
                    </label>
                    <input
                      id="complete-aadhaar"
                      type="text"
                      required
                      maxLength={4}
                      pattern="[0-9]{4}"
                      className={INPUT}
                      value={form.aadhaarLast4}
                      onChange={(e) => set("aadhaarLast4", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="complete-income">
                      {t("annual_income")}
                    </label>
                    <input
                      id="complete-income"
                      type="number"
                      min={0}
                      required
                      className={INPUT}
                      value={form.annualIncome}
                      onChange={(e) => set("annualIncome", e.target.value)}
                      placeholder="85000"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="kg-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-maroon)] text-[15px] font-semibold text-[#F0A48C] transition-colors hover:bg-[#6B2020] disabled:opacity-60"
            >
              {loading && <Loader2 size={17} className="animate-spin" />}
              {loading ? t("auth_creating") : t("auth_complete_cta")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
