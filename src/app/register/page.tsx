"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, User, MapPin, Briefcase, Info, UserRound } from "lucide-react";
import { CITY_OPTIONS, locateCity } from "@/lib/indiaGeo";
import { GENDERS, GENDER_LABELS } from "@/lib/gender";

import { Avatar } from "@/components/ui/Avatar";
import { downscaleImage } from "@/lib/imageEnhance";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [role, setRole] = useState<'ARTISAN' | 'ADMIN'>('ARTISAN');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** Optional profile photo, held as a compact JPEG data URL. */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    craftType: "Ikat",
    location: "",
    experienceYears: "",
    aadhaarLast4: "",
    annualIncome: "",
    clusterName: "",
    shgGroupLink: "",
    gender: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // The demand map can only pin a town it knows. Warn while typing rather than
  // silently registering someone who will never appear on the map.
  const locationResolves = Boolean(locateCity(formData.location));

  /**
   * Compressed before it ever leaves the page: a phone selfie is several
   * megabytes, and this string is stored on the profile row and re-sent with
   * every query that reads it.
   */
  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (loaded) => {
      if (typeof loaded.target?.result !== "string") return;
      // 320px is ample for an avatar circle.
      setPhotoUrl(await downscaleImage(loaded.target.result, 320, 0.82));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          role,
          photoUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to register");
      }

      // Success! The httpOnly cookie is set. Redirect to dashboard.
      if (role === 'ADMIN') {
        router.push("/admin/facilitator");
      } else {
        router.push("/artisan/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
    } finally {
      setLoading(false);
    }
  };

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
        <div className="absolute inset-x-0 bottom-0 p-12">
          <h2 className="kg-display text-[30px] leading-tight text-white">Partner with us</h2>
          <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/75">
            Register your workshop and every piece you publish carries a patch ID, a fair-wage
            floor, and settlement straight to your own UPI.
          </p>
          <p className="kg-label mt-8 flex items-center gap-4 font-medium text-white/60">
            <span aria-hidden className="block h-px w-10 bg-white/40" />
            The Artisan Network
          </p>
        </div>
      </div>

      {/* -------------------------------------------------- Panel */}
      <div className="flex min-h-screen flex-col justify-center bg-white px-6 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-[520px]">
          <Link href="/" className="kg-display block text-2xl leading-none text-gray-900">
            Karigari
          </Link>

          <h1 className="kg-display mt-10 text-[28px] leading-tight text-gray-900">
            Register as Artisan
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-600">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-gray-900 underline underline-offset-4">
              Sign in
            </Link>
          </p>

          {/* Role toggle. Real radios: it is one choice out of a set. */}
          <div
            role="radiogroup"
            aria-label="Account type"
            className="mt-9 grid grid-cols-2 gap-1 rounded-xl bg-[var(--color-pill)] p-1"
          >
            {[
              { value: "ARTISAN" as const, label: "Artisan", icon: <User size={15} /> },
              { value: "ADMIN" as const, label: "Admin", icon: <ShieldCheck size={15} /> },
            ].map((option) => {
              const active = role === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRole(option.value)}
                  className={cn(
                    "kg-press flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-[14px] font-semibold transition-colors",
                    active ? "bg-white text-gray-900 shadow-card" : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              );
            })}
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {/* Optional profile photo. Skipping it is fine — the Avatar falls
                back to initials on a colour derived from the name. */}
            <div className="flex items-center gap-4 rounded-2xl bg-[var(--color-background)] p-4">
              <Avatar name={formData.name} src={photoUrl} size={56} />
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="text-[13px] font-semibold text-gray-900 underline underline-offset-4"
                >
                  {photoUrl ? t("change_photo") : t("add_photo")}
                </button>
                {photoUrl && (
                  <button
                    type="button"
                    onClick={() => setPhotoUrl(null)}
                    className="ml-4 text-[13px] font-medium text-gray-500 transition-colors hover:text-red-600"
                  >
                    {t("remove")}
                  </button>
                )}
                <p className="mt-1 text-xs text-gray-500">{t("photo_optional_hint")}</p>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoPick}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
              >
                {error}
              </p>
            )}

            <Field label="Full name" htmlFor="name">
              <input id="name" name="name" type="text" required value={formData.name}
                onChange={handleChange} placeholder="Sunita R." className={INPUT} />
            </Field>

            <Field label="Email address" htmlFor="email">
              <input id="email" name="email" type="email" autoComplete="email" required
                value={formData.email} onChange={handleChange} placeholder="sunita@example.com"
                className={INPUT} />
            </Field>

            <Field label="Password" htmlFor="password">
              <input id="password" name="password" type="password" autoComplete="new-password"
                required value={formData.password} onChange={handleChange} placeholder="••••••••"
                className={INPUT} />
            </Field>

            {role === "ARTISAN" && (
              <div className="space-y-5 border-t border-gray-200 pt-6">
                <Field label="Craft type" htmlFor="craftType" icon={<Briefcase size={13} />}>
                  <select id="craftType" name="craftType" value={formData.craftType}
                    onChange={handleChange} className={cn(INPUT, "appearance-none")}>
                    <option value="Ikat">Ikat Weaving</option>
                    <option value="Banarasi">Banarasi Brocade</option>
                    <option value="Dhokra">Dhokra Metal Craft</option>
                    <option value="Pattachitra">Pattachitra Painting</option>
                  </select>
                </Field>

                <Field
                  label="Gender"
                  htmlFor="gender"
                  icon={<UserRound size={13} />}
                  hint="Used to check women-only scheme eligibility, such as GeM Womaniya."
                >
                  <select id="gender" name="gender" required value={formData.gender}
                    onChange={handleChange} className={cn(INPUT, "appearance-none")}>
                    <option value="" disabled>Select gender</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>{GENDER_LABELS[g]}</option>
                    ))}
                  </select>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Town or city" htmlFor="location" icon={<MapPin size={13} />}>
                    <input id="location" name="location" type="text" required
                      list="karigari-cities" autoComplete="off" value={formData.location}
                      onChange={handleChange} placeholder="Start typing, e.g. Pochampally"
                      className={INPUT} />
                    <datalist id="karigari-cities">
                      {CITY_OPTIONS.map((city) => (
                        <option key={city} value={city} />
                      ))}
                    </datalist>
                  </Field>

                  <Field label="Experience (years)" htmlFor="experienceYears">
                    <input id="experienceYears" name="experienceYears" type="number" required
                      min="0" value={formData.experienceYears} onChange={handleChange}
                      placeholder="5" className={INPUT} />
                  </Field>
                </div>

                {formData.location.trim() !== "" && !locationResolves && (
                  <p className="flex items-start gap-2 rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs leading-relaxed text-orange-800">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    We do not have this place on the demand map yet. Pick the nearest town from the
                    list so buyers near you can find you — a state name on its own will not place a
                    pin.
                  </p>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Aadhaar (last 4)" htmlFor="aadhaarLast4">
                    <input id="aadhaarLast4" name="aadhaarLast4" type="text" required maxLength={4}
                      pattern="[0-9]{4}" value={formData.aadhaarLast4} onChange={handleChange}
                      placeholder="1234" className={INPUT} />
                  </Field>

                  <Field label="Annual income (₹)" htmlFor="annualIncome">
                    <input id="annualIncome" name="annualIncome" type="number" required min="0"
                      value={formData.annualIncome} onChange={handleChange} placeholder="85000"
                      className={INPUT} />
                  </Field>
                </div>

                <Field
                  label="Cluster name (optional)"
                  htmlFor="clusterName"
                  icon={<User size={13} />}
                  hint="A cooperative or village weaving group you belong to."
                >
                  <input id="clusterName" name="clusterName" type="text" value={formData.clusterName}
                    onChange={handleChange} placeholder="e.g. Pochampally Weavers" className={INPUT} />
                </Field>

                <Field
                  label="Link to SHG group (optional)"
                  htmlFor="shgGroupLink"
                  icon={<User size={13} />}
                  hint="Joining an SHG groups you with everyone sharing this link on the Cluster page, whatever their location."
                >
                  <input
                    id="shgGroupLink"
                    name="shgGroupLink"
                    type="url"
                    value={formData.shgGroupLink}
                    onChange={handleChange}
                    placeholder="https://shg.example.com/group/..."
                    className={INPUT}
                  />
                </Field>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="kg-press flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--color-maroon)] text-[15px] font-semibold text-[#F0A48C] transition-colors hover:bg-[#6B2020] disabled:opacity-60"
            >
              {loading ? "Registering…" : `Register as ${role === "ADMIN" ? "Admin" : "Artisan"}`}
            </button>
          </form>
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
  icon,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-gray-800"
      >
        {icon}
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{hint}</p>}
    </div>
  );
}
