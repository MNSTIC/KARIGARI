"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Fingerprint,
  Loader2,
  MapPin,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { FIELD_INPUT, FIELD_INPUT_INVALID, Field, FieldSection, describedBy } from "@/components/ui/FormField";
import { CITY_OPTIONS } from "@/lib/indiaGeo";
import { GENDERS, GENDER_LABELS } from "@/lib/gender";
import { GI_LABELS } from "@/lib/giLabels";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * Finish a Google sign-up — step 2 of 2, and artisan-only.
 *
 * Google gives us a verified email, a name and a picture. It cannot give us
 * craftType, location, experienceYears, aadhaarLast4, annualIncome or gender —
 * six fields an artisan account is not usable without — so a Google sign-up
 * cannot be one hop, and this is the second one.
 *
 * THERE IS NO ROLE CONTROL ON THIS SCREEN, AND THAT IS DELIBERATE. The role is
 * decided once, at `/api/auth/google/start`, and carried in a JWT-signed
 * httpOnly cookie the browser cannot read or edit. This page used to read
 * `?role=` from the URL and post it back, which handed the browser the choice
 * of the privilege level of the account being created. An ADMIN sign-up is now
 * completed in the callback and never reaches this screen at all — every
 * visitor here is an artisan, so every field renders unconditionally.
 *
 * The identity is held in that same short-lived cookie. This screen never sees
 * it except as the name and avatar the server hands back from
 * `/api/auth/google/pending`; the email is rendered as read-only text rather
 * than an input because it is not ours to change.
 *
 * The fields and their validation are `/register`'s, and the server runs the
 * submission through the SAME `validateSignup()` the password route uses — two
 * screens creating accounts with two copies of the rules would drift.
 */

interface Pending {
  email: string;
  name: string;
  picture: string | null;
}

/** Only the fields whose validation can fail. Mirrors `validateSignup()`. */
type FieldErrors = Partial<Record<"name" | "gender" | "aadhaarLast4" | "annualIncome", string>>;

/**
 * The validated fields in the order they appear on screen, with their input ids.
 *
 * Focus management reads THIS rather than querying the DOM for
 * `[aria-invalid="true"]`. The obvious version — set the errors, then
 * `querySelector` for the first invalid control — silently focuses nothing:
 * the query runs in the submit handler, before React has re-rendered, so no
 * element carries the attribute yet. Verified by submitting an empty form and
 * finding `document.activeElement` still on the button.
 *
 * An explicit list also fixes the ordering bug underneath that one. Iterating
 * the errors object would follow insertion order, which is the order the
 * validator happens to run in, not the order the person reads.
 */
const FIELD_ORDER: ReadonlyArray<{ key: keyof FieldErrors; id: string }> = [
  { key: "name", id: "complete-name" },
  { key: "gender", id: "complete-gender" },
  { key: "aadhaarLast4", id: "complete-aadhaar" },
  { key: "annualIncome", id: "complete-income" },
];

/** The shell both the form and every other state render inside. */
function AuthShell({ children, plate }: { children: React.ReactNode; plate: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans lg:grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* -------------------------------------------------- Plate */}
      <div className="relative hidden overflow-hidden lg:block">
        <Image
          src="/hero-mural.jpg"
          alt="A hand-painted Pattachitra scroll from Odisha"
          fill
          priority
          sizes="440px"
          className="object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/20"
        />
        <div className="absolute inset-x-0 bottom-0 p-12">{plate}</div>
      </div>

      {/* -------------------------------------------------- Panel */}
      <div className="flex min-h-screen flex-col justify-center bg-white px-6 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-[520px]">{children}</div>
      </div>
    </div>
  );
}

export default function CompleteSignupPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [pending, setPending] = useState<Pending | null>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Set when the POST 401s, so the message can offer a route back rather than
      a dead end. The cookie lives ten minutes and a slow form can outlast it. */
  const [expired, setExpired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  /** Shown after the account exists, so a passkey has something to attach to. */
  const [created, setCreated] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyDone, setPasskeyDone] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  const [form, setForm] = useState({
    name: "",
    // Empty, not "Ikat". The old default silently chose a craft on behalf of
    // every artisan who did not touch the field, and Ikat is not a neutral
    // default — it is a specific tradition from specific districts.
    craftType: "",
    location: "",
    experienceYears: "",
    aadhaarLast4: "",
    annualIncome: "",
    clusterName: "",
    shgGroupLink: "",
    gender: "",
  });

  const plate = (
    <>
      <h2 className="kg-display text-[30px] leading-tight text-white">
        {t("auth_complete_plate_title")}
      </h2>
      <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/75">
        {t("auth_complete_plate_body")}
      </p>
      <p className="kg-label mt-8 flex items-center gap-4 font-medium text-white/60">
        <span aria-hidden className="block h-px w-10 bg-white/40" />
        {t("auth_complete_plate_label")}
      </p>
    </>
  );

  // Deferred by a macrotask so the effect body performs no synchronous
  // setState — the same kickoff pattern the rest of this app uses.
  useEffect(() => {
    const kickoff = setTimeout(async () => {
      try {
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

  const set = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear this field's error as soon as it is touched. Leaving a stale red
    // message under a field the person is actively fixing reads as the app not
    // noticing them.
    if (key in fieldErrors) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof FieldErrors];
        return next;
      });
    }
  };

  /**
   * The same four rules `validateSignup()` enforces, checked here first.
   *
   * This is a duplication of logic, and it is the acceptable kind: the server
   * remains the authority and rejects anything that gets past this, but a
   * person who leaves the gender blank deserves to be told which field is wrong
   * rather than handed one sentence at the top of a form eight fields long.
   * Anything stricter than the server would be a bug — it would reject payloads
   * the password path accepts.
   */
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!form.name.trim()) errors.name = t("validation_name_required");
    if (!form.gender) errors.gender = t("validation_gender_required");
    if (!/^\d{4}$/.test(form.aadhaarLast4)) {
      errors.aadhaarLast4 = t("validation_aadhaar_four_digits");
    }
    if (form.annualIncome.trim() === "" || !Number.isFinite(Number(form.annualIncome))) {
      errors.annualIncome = t("validation_income_required");
    }
    return errors;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(t("validation_fix_fields"));
      // The inputs themselves are always mounted, so this resolves immediately
      // — it is only the `aria-invalid` attribute that is a render behind.
      const first = FIELD_ORDER.find((f) => errors[f.key]);
      if (first) formRef.current?.querySelector<HTMLElement>(`#${first.id}`)?.focus();
      return;
    }

    setLoading(true);
    setError("");
    setExpired(false);
    setFieldErrors({});
    try {
      const res = await fetch("/api/auth/google/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `role` here, and none accepted there. See the route's comment on
        // why the key order in its `validateSignup` call is a security control.
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        // A 401 means the ten-minute cookie is gone. That is a different
        // problem from a bad field and needs a different sentence plus a way
        // out, otherwise the person retries into the same wall forever.
        if (res.status === 401 || data?.expired) {
          setExpired(true);
          setError(t("auth_signin_expired"));
          return;
        }
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
      // A cancelled prompt throws. That is not an error worth shouting about —
      // the person changed their mind.
      const name = (e as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") {
        console.error("Passkey setup failed:", e);
        setError(t("passkey_failed"));
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  /** Unconditional: only an artisan ever reaches this screen. */
  const goToDashboard = () => {
    router.push("/artisan/dashboard");
    router.refresh();
  };

  const wordmark = (
    <Link href="/" className="kg-display block text-2xl leading-none text-gray-900">
      Karigari
    </Link>
  );

  // ---- Loading: the real shell with a skeleton, not a spinner on a void ----
  if (checking) {
    return (
      <AuthShell plate={plate}>
        <div aria-busy="true" aria-live="polite">
          {wordmark}
          <div className="kg-shimmer mt-10 h-9 w-[min(340px,80%)] rounded-lg" />
          <div className="kg-shimmer mt-3 h-3.5 w-[min(460px,95%)] rounded" />
          <div className="kg-shimmer mt-9 h-[88px] rounded-2xl" />
          <div className="mt-8 space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="kg-shimmer mb-2 h-3 w-28 rounded" />
                <div className="kg-shimmer h-[52px] rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </AuthShell>
    );
  }

  // The redirect has been ordered but has not painted yet. A blank white page
  // in that window looks like a crash; one sentence looks like the app working.
  if (!pending) {
    return (
      <AuthShell plate={plate}>
        {wordmark}
        <p className="mt-10 flex items-center gap-2 text-[15px] text-gray-600" aria-live="polite">
          <Loader2 size={16} className="animate-spin" />
          {t("auth_returning_to_signin")}
        </p>
      </AuthShell>
    );
  }

  const identityPanel = (
    <div className="mt-9 flex items-start gap-4 rounded-2xl bg-[var(--color-background)] p-4">
      <Avatar name={pending.name || pending.email} src={pending.picture} size={56} priority />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-gray-900">
          {pending.name || pending.email}
        </p>
        <p className="truncate text-[13px] text-gray-600">{pending.email}</p>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-gray-500">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          {t("auth_verified_by_google")}
        </p>
      </div>
    </div>
  );

  // ---- Success: the account exists, the passkey is an optional upgrade ----
  if (created) {
    return (
      <AuthShell plate={plate}>
        {wordmark}

        <div className="mt-10 flex items-start gap-3">
          <CheckCircle2 size={26} className="mt-1 shrink-0 text-[var(--color-maroon)]" />
          <div>
            <h1 className="kg-display text-[28px] leading-tight text-gray-900">
              {t("auth_account_ready")}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-600">
              {passkeyDone ? t("passkey_added") : t("passkey_offer_body")}
            </p>
          </div>
        </div>

        {!passkeyDone && (
          <p className="mt-6 rounded-2xl bg-[var(--color-background)] p-4 text-[13px] leading-relaxed text-gray-600">
            {t("passkey_why")}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] font-medium text-red-600">
            {error}
          </p>
        )}

        {/* Both actions carry the same weight. Skipping a passkey is a real
            choice — the account works either way — so it is not a greyed-out
            afterthought under a louder button. */}
        <div className="mt-8 space-y-3">
          {!passkeyDone && (
            <button
              type="button"
              onClick={() => void addPasskey()}
              disabled={passkeyBusy}
              className={cn(
                "kg-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gray-100 text-[15px] font-semibold text-gray-800 transition-colors hover:bg-gray-200",
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
          <button
            type="button"
            onClick={goToDashboard}
            className="kg-press flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--color-maroon)] text-[15px] font-semibold text-[#F0A48C] transition-colors hover:bg-[#6B2020]"
          >
            {passkeyDone ? t("continue_btn") : t("passkey_skip")}
          </button>
        </div>
      </AuthShell>
    );
  }

  // ---- The form ----------------------------------------------------------
  return (
    <AuthShell plate={plate}>
      {wordmark}

      <h1 className="kg-display mt-10 text-[28px] leading-tight text-gray-900">
        {t("auth_complete_title")}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-gray-600">{t("auth_complete_lede")}</p>

      {identityPanel}

      <form ref={formRef} className="mt-8 space-y-8" onSubmit={submit} noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
            {expired && (
              <>
                {" "}
                <Link href="/login" className="font-semibold underline underline-offset-4">
                  {t("auth_back_to_signin")}
                </Link>
              </>
            )}
          </p>
        )}

        {/* Every input is disabled while the POST is in flight. The pending
            cookie is single-use, so a double-submit burns it and the second
            request would fail with an expiry message on a form that was
            perfectly valid. */}
        <fieldset disabled={loading} className="space-y-8">
          {/* ---------------------------------------- 1. Your details */}
          <FieldSection title={t("auth_section_details")} className="border-t-0 pt-0">
            <Field label={t("full_name")} htmlFor="complete-name" error={fieldErrors.name}>
              <input
                id="complete-name"
                name="name"
                type="text"
                autoComplete="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={describedBy("complete-name", { error: Boolean(fieldErrors.name) })}
                className={cn(FIELD_INPUT, fieldErrors.name && FIELD_INPUT_INVALID)}
              />
            </Field>

            <Field
              label={t("gender")}
              htmlFor="complete-gender"
              icon={<UserRound size={13} />}
              hint={t("gender_why")}
              error={fieldErrors.gender}
            >
              {/* `appearance-none` strips the platform chevron, which left this
                  looking like a dead text input. The arrow is drawn back on
                  rather than restoring the native one, so it matches the other
                  selects in the app. */}
              <div className="relative">
                <select
                  id="complete-gender"
                  name="gender"
                  value={form.gender}
                  onChange={(e) => set("gender", e.target.value)}
                  aria-invalid={Boolean(fieldErrors.gender)}
                  aria-describedby={describedBy("complete-gender", {
                    hint: true,
                    error: Boolean(fieldErrors.gender),
                  })}
                  className={cn(
                    FIELD_INPUT,
                    "appearance-none pr-11",
                    fieldErrors.gender && FIELD_INPUT_INVALID
                  )}
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
                <ChevronDown
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500"
                />
              </div>
            </Field>
          </FieldSection>

          {/* ---------------------------------------- 2. Your craft */}
          <FieldSection title={t("auth_section_craft")}>
            <Field label={t("craft_type")} htmlFor="complete-craft" icon={<Briefcase size={13} />}>
              {/* A datalist, not a select: the four hardcoded options on
                  `/register` cannot cover India's crafts, and a person whose
                  tradition is missing from a dropdown has no way to say what
                  they do. This suggests without deciding. */}
              <input
                id="complete-craft"
                name="craftType"
                type="text"
                list="karigari-crafts"
                autoComplete="off"
                value={form.craftType}
                onChange={(e) => set("craftType", e.target.value)}
                placeholder={t("craft_type_placeholder")}
                className={FIELD_INPUT}
              />
              <datalist id="karigari-crafts">
                {GI_LABELS.map((craft) => (
                  <option key={craft.label} value={craft.label} />
                ))}
              </datalist>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("town_or_city")} htmlFor="complete-location" icon={<MapPin size={13} />}>
                <input
                  id="complete-location"
                  name="location"
                  type="text"
                  list="karigari-cities"
                  autoComplete="address-level2"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder={t("location_placeholder")}
                  className={FIELD_INPUT}
                />
                <datalist id="karigari-cities">
                  {CITY_OPTIONS.map((city) => (
                    <option key={city} value={city} />
                  ))}
                </datalist>
              </Field>

              <Field label={t("experience_years")} htmlFor="complete-experience">
                <input
                  id="complete-experience"
                  name="experienceYears"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={80}
                  value={form.experienceYears}
                  onChange={(e) => set("experienceYears", e.target.value)}
                  placeholder="5"
                  className={FIELD_INPUT}
                />
              </Field>
            </div>
          </FieldSection>

          {/* ---------------------------------------- 3. Verification & group */}
          <FieldSection
            title={t("auth_section_verification")}
            description={t("auth_section_verification_note")}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t("aadhaar_last4")}
                htmlFor="complete-aadhaar"
                hint={t("aadhaar_last4_hint")}
                error={fieldErrors.aadhaarLast4}
              >
                {/* `type="text"` with `inputMode="numeric"`, not
                    `type="number"`: a number input strips leading zeros, and
                    "0421" is a perfectly ordinary set of last-four digits. The
                    inputMode is what raises the phone's number pad. */}
                <input
                  id="complete-aadhaar"
                  name="aadhaarLast4"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={form.aadhaarLast4}
                  onChange={(e) => set("aadhaarLast4", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="1234"
                  aria-invalid={Boolean(fieldErrors.aadhaarLast4)}
                  aria-describedby={describedBy("complete-aadhaar", {
                    hint: true,
                    error: Boolean(fieldErrors.aadhaarLast4),
                  })}
                  className={cn(FIELD_INPUT, fieldErrors.aadhaarLast4 && FIELD_INPUT_INVALID)}
                />
              </Field>

              <Field
                label={t("annual_income")}
                htmlFor="complete-income"
                error={fieldErrors.annualIncome}
              >
                <input
                  id="complete-income"
                  name="annualIncome"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.annualIncome}
                  onChange={(e) => set("annualIncome", e.target.value)}
                  placeholder="85000"
                  aria-invalid={Boolean(fieldErrors.annualIncome)}
                  aria-describedby={describedBy("complete-income", {
                    error: Boolean(fieldErrors.annualIncome),
                  })}
                  className={cn(FIELD_INPUT, fieldErrors.annualIncome && FIELD_INPUT_INVALID)}
                />
              </Field>
            </div>

            {/* Both optional, both on the password register page too. Without
                them here a Google artisan silently defaulted to the
                'Independent' cluster, which is the fallback for someone who
                belongs to no group — not something to assume on their behalf. */}
            <Field
              label={t("cluster_name_optional")}
              htmlFor="complete-cluster"
              icon={<Users size={13} />}
              hint={t("cluster_name_hint")}
            >
              <input
                id="complete-cluster"
                name="clusterName"
                type="text"
                value={form.clusterName}
                onChange={(e) => set("clusterName", e.target.value)}
                placeholder="e.g. Pochampally Weavers"
                aria-describedby={describedBy("complete-cluster", { hint: true })}
                className={FIELD_INPUT}
              />
            </Field>

            <Field
              label={t("shg_link_optional")}
              htmlFor="complete-shg"
              icon={<Users size={13} />}
              hint={t("shg_link_hint")}
            >
              <input
                id="complete-shg"
                name="shgGroupLink"
                type="url"
                value={form.shgGroupLink}
                onChange={(e) => set("shgGroupLink", e.target.value)}
                placeholder="https://shg.example.com/group/..."
                aria-describedby={describedBy("complete-shg", { hint: true })}
                className={FIELD_INPUT}
              />
            </Field>
          </FieldSection>

          <button
            type="submit"
            className="kg-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-maroon)] text-[15px] font-semibold text-[#F0A48C] transition-colors hover:bg-[#6B2020] disabled:opacity-60"
          >
            {loading && <Loader2 size={17} className="animate-spin" />}
            {loading ? t("auth_creating") : t("auth_complete_cta")}
          </button>
        </fieldset>
      </form>
    </AuthShell>
  );
}
