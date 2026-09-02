"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage, type Language } from "@/lib/translations";
import { cn } from "@/lib/utils";

type Role = "ARTISAN" | "ADMIN";

/**
 * Sign in.
 *
 * The layout is the reference's split screen — textile plate and quote on the
 * left, a quiet white panel on the right. The **form is not**: the reference
 * shows a mobile number and a four-box OTP, and this app has no OTP rail. It
 * authenticates with email + password against `POST /api/auth/login`, so that
 * is what the panel asks for. Shipping a non-functional OTP form would look
 * right and lock every artisan out.
 *
 * The role toggle is Artisan / Admin for the same reason: those are the only
 * two roles the schema has. The reference's third "Facilitator" tab maps to no
 * distinct login — one ADMIN account opens both the Facilitator and the Nodal
 * dashboards — so it is not drawn.
 */
export default function LoginPage() {
  const router = useRouter();
  const { t, language, changeLanguage } = useLanguage();
  const [role, setRole] = useState<Role>("ARTISAN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({ email: "", password: "" });

  // "For Admins" on the landing page arrives as /login?role=admin. Read it off
  // the URL in a deferred effect rather than via useSearchParams, so this fully
  // client page needs no Suspense boundary — the pattern the dashboard uses.
  useEffect(() => {
    const kickoff = setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("role");
      if (requested?.toLowerCase() === "admin") setRole("ADMIN");
      else if (requested?.toLowerCase() === "artisan") setRole("ARTISAN");
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log in");

      // Check they picked the tab that matches the account.
      if (data.user.role === "ADMIN" && role === "ARTISAN") {
        throw new Error("Invalid role. This account belongs to an Admin.");
      }
      if (data.user.role === "ARTISAN" && role === "ADMIN") {
        throw new Error("Invalid role. This account belongs to an Artisan.");
      }

      // One ADMIN role opens both admin dashboards; land on Facilitator.
      router.push(data.user.role === "ADMIN" ? "/admin/facilitator" : "/artisan/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans lg:grid lg:grid-cols-2">
      {/* -------------------------------------------------- Plate */}
      <div className="relative hidden overflow-hidden lg:block">
        <Image
          src="/login-hero.jpg"
          alt="A hand-painted Pattachitra scroll on cloth, hung on a village wall"
          fill
          priority
          sizes="50vw"
          className="scale-105 object-cover blur-[2px]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10"
        />
        <figure className="absolute inset-x-0 bottom-0 p-12 xl:p-16">
          <blockquote className="max-w-md text-[17px] leading-relaxed text-white/90">
            &ldquo;Every thread spun, every shape moulded, is a testament to human ingenuity and
            the enduring dignity of craft.&rdquo;
          </blockquote>
          <figcaption className="kg-label mt-6 flex items-center gap-4 font-medium text-white/70">
            <span aria-hidden className="block h-px w-10 bg-white/50" />
            The Artisan Network
          </figcaption>
        </figure>
      </div>

      {/* -------------------------------------------------- Panel */}
      <div className="flex min-h-screen flex-col justify-center bg-white px-6 py-12 sm:px-10 lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-[420px]">
          <Link href="/" className="kg-display block text-2xl leading-none text-gray-900">
            Karigari
          </Link>

          <h1 className="kg-display mt-10 text-[28px] leading-tight text-gray-900">
            {t("login_welcome")}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-600">
            Sign in to manage your craft portfolio and network.
          </p>

          {/* Segmented role toggle. Real radios, because it is one choice out of
              a set and a screen reader has to be told that. */}
          <div
            role="radiogroup"
            aria-label="Account type"
            className="mt-9 grid grid-cols-2 gap-1 rounded-xl bg-[var(--color-pill)] p-1"
          >
            {(
              [
                { value: "ARTISAN", label: t("role_artisan") },
                { value: "ADMIN", label: t("role_admin") },
              ] as { value: Role; label: string }[]
            ).map((option) => {
              const active = role === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRole(option.value)}
                  className={cn(
                    "kg-press min-h-[44px] rounded-lg text-[14px] font-semibold transition-colors",
                    active ? "bg-white text-gray-900 shadow-card" : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
              >
                {error}
              </p>
            )}

            <Field label={t("email_address")} htmlFor="email">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="artisan@karigari.com"
                className={INPUT}
              />
            </Field>

            <Field label={t("password")} htmlFor="password">
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className={INPUT}
              />
            </Field>

            <Field label={t("language")} htmlFor="language">
              <select
                id="language"
                /* Goes through changeLanguage, not localStorage directly: that
                   is what dispatches `language-change`, so every other mounted
                   component re-renders instead of waiting for a reload. */
                onChange={(e) => changeLanguage(e.target.value as Language)}
                value={language}
                className={cn(INPUT, "appearance-none bg-white pr-10")}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="or">ଓଡ଼ିଆ (Odia)</option>
                <option value="te">తెలుగు (Telugu)</option>
              </select>
            </Field>

            <button
              type="submit"
              disabled={loading}
              className="kg-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-maroon)] text-[15px] font-semibold text-[#F0A48C] transition-colors hover:bg-[#6B2020] disabled:opacity-60"
            >
              {loading && <Loader2 size={17} className="animate-spin" />}
              {loading ? t("signing_in") : "Verify & Login"}
            </button>
          </form>

          <div className="mt-12 border-t border-gray-200 pt-8 text-center">
            <p className="text-[14px] text-gray-600">New to the platform?</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                href="/register"
                className="kg-press inline-flex min-h-[46px] items-center rounded-xl border border-gray-300 px-5 text-[14px] font-semibold text-gray-800 hover:border-gray-400 hover:bg-gray-50"
              >
                Register as Artisan
              </Link>
              <Link
                href="/creators"
                className="kg-press inline-flex min-h-[46px] items-center rounded-xl border border-gray-300 px-5 text-[14px] font-semibold text-gray-800 hover:border-gray-400 hover:bg-gray-50"
              >
                Partner with us
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const INPUT =
  "block h-[52px] w-full rounded-xl border border-gray-300 bg-white px-4 text-[15px] text-gray-900 placeholder:text-gray-400 transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-[13px] font-semibold text-gray-800">
        {label}
      </label>
      {children}
    </div>
  );
}
