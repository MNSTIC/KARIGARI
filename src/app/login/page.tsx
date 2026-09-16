"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Loader2, Mail, Lock, Eye, EyeOff, Globe, ArrowRight } from "lucide-react";
import { useLanguage, type Language } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { AltSignIn } from "@/components/AltSignIn";
import { AlreadySignedInBanner } from "@/components/AlreadySignedInBanner";

type Role = "ARTISAN" | "ADMIN";

export default function LoginPage() {
  const router = useRouter();
  const { t, language, changeLanguage } = useLanguage();
  const [role, setRole] = useState<Role>("ARTISAN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const kickoff = setTimeout(() => {
      const code = new URLSearchParams(window.location.search).get("notice");
      if (!code) return;
      const KNOWN = [
        "existing_password_account",
        "google_cancelled",
        "google_state",
        "google_exchange",
        "google_token",
        "google_unavailable",
        "google_failed",
      ];
      setNotice(KNOWN.includes(code) ? `auth_notice_${code}` : "auth_notice_google_failed");
    }, 0);
    return () => clearTimeout(kickoff);
  }, []);

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

      if (data.user.role === "ADMIN" && role === "ARTISAN") {
        throw new Error("Invalid role. This account belongs to an Admin.");
      }
      if (data.user.role === "ARTISAN" && role === "ADMIN") {
        throw new Error("Invalid role. This account belongs to an Artisan.");
      }

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
      <div className="relative flex min-h-screen flex-col justify-center bg-[#F6F3EE] px-6 py-12 sm:px-10 lg:px-16 xl:px-24">
        {/* Background Pattern */}
        <div className="absolute inset-0 z-0 opacity-[0.16] bg-[url('/droodle-bg.jpg')] bg-repeat bg-[length:500px_auto] mix-blend-multiply pointer-events-none" />
        
        {/* Glassy Card Wrapper */}
        <div className="relative z-10 mx-auto w-full max-w-[420px] rounded-[32px] bg-white/50 backdrop-blur-md p-6 sm:p-8 shadow-[0_8px_32px_rgba(26,26,26,0.06)] border border-white/60">
          
          <div className="flex flex-col items-center text-center">
            <Link href="/" className="flex flex-col items-center">
              <Image 
                src="/auth-logo-transparent.png" 
                alt="Karigari" 
                width={1024} 
                height={366} 
                priority
                className="w-[220px] sm:w-[250px] h-auto object-contain drop-shadow-sm"
              />
            </Link>

            <h1 className="kg-display mt-8 text-[24px] leading-tight text-gray-900">
              Welcome back
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
              Sign in to manage your craft portfolio and network.
            </p>
          </div>

          <AlreadySignedInBanner />

          <div
            role="radiogroup"
            aria-label="Account type"
            className="mt-8 grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1 backdrop-blur-sm"
          >
            {(
              [
                { value: "ARTISAN", label: "Artisan" },
                { value: "ADMIN", label: "Admin" },
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
                    "kg-press min-h-[40px] rounded-lg text-[13px] font-semibold transition-colors",
                    active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {notice && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            >
              {t(notice)}
            </p>
          )}

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
              >
                {error}
              </p>
            )}

            <Field icon={<Mail size={16} />}>
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

            <Field 
              icon={<Lock size={16} />} 
              suffix={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-gray-500 hover:text-gray-800 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            >
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className={INPUT}
              />
            </Field>

            <Field icon={<Globe size={16} />}>
              <select
                id="language"
                onChange={(e) => changeLanguage(e.target.value as Language)}
                value={language}
                className={cn(INPUT, "appearance-none pr-10")}
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
              className="kg-press mt-2 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#1A3A30] text-[14px] font-semibold text-white transition-colors hover:bg-[#122A22] disabled:opacity-60"
            >
              {loading && <Loader2 size={17} className="animate-spin" />}
              {loading ? t("signing_in") : "Verify & Login"}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <AltSignIn role={role} />

          <div className="mt-8 pt-6 text-center">
            <p className="text-[13px] text-gray-600">New to the platform?</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                href="/register"
                className="kg-press inline-flex min-h-[42px] items-center rounded-xl border border-black/10 bg-transparent px-4 text-[13px] font-semibold text-gray-800 transition-colors hover:bg-black/5"
              >
                Register as Artisan
              </Link>
              <Link
                href="/creators"
                className="kg-press inline-flex min-h-[42px] items-center rounded-xl border border-black/10 bg-transparent px-4 text-[13px] font-semibold text-gray-800 transition-colors hover:bg-black/5"
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
  "block h-[50px] w-full rounded-xl border border-gray-200 bg-white shadow-sm pl-11 pr-4 text-[14px] text-gray-900 placeholder:text-gray-500 transition-colors focus:border-[#1A3A30] focus:outline-none focus:ring-1 focus:ring-[#1A3A30]";

function Field({
  icon,
  suffix,
  children,
}: {
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {icon && (
        <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-gray-500">
          {icon}
        </div>
      )}
      {children}
      {suffix && (
        <div className="absolute inset-y-0 right-4 flex items-center">
          {suffix}
        </div>
      )}
    </div>
  );
}
