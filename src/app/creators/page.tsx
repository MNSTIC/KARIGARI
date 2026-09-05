"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Camera,
  Loader2,
  MapPin,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  GraduationCap,
  Upload,
  Users,
  CirclePlay,
} from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Avatar } from "@/components/ui/Avatar";
import { useLanguage } from "@/lib/translations";
import { downscaleImage } from "@/lib/imageEnhance";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  CREATOR_NICHES,
  CREATOR_PLATFORMS,
  platformLabel,
  slugifyHandle,
  type PublicCreator,
} from "@/lib/creators";

/**
 * The public creator/influencer portal.
 *
 * Two halves that answer the only two questions a local creator has: who else
 * is doing this, and how do I get my link. Everything shown is a real row —
 * the click and sale counts come from the database, so a brand-new programme
 * honestly shows zeros rather than inventing traction.
 */

interface CreatorStats {
  name: string;
  handle: string;
  totalClicks: number;
  totalSales: number;
  grossVolume: number;
  earningsTotal: number;
  pendingCommission: number;
  payoutUpi: string;
}

function PlatformMark({ platform, className }: { platform: string; className?: string }) {
  // lucide-react v1 dropped its brand marks, so these are neutral stand-ins
  // rather than Instagram/YouTube logos — the label beside them carries the name.
  if (platform === "INSTAGRAM") return <Camera size={13} className={className} />;
  if (platform === "YOUTUBE") return <CirclePlay size={13} className={className} />;
  return <GraduationCap size={13} className={className} />;
}

export default function CreatorsPage() {
  const { t } = useLanguage();

  const [creators, setCreators] = useState<PublicCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/creators", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data?.success) {
        setCreators(data.creators || []);
      } else {
        setLoadFailed(true);
      }
    } catch (error) {
      console.error("Failed to load creators:", error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the marketplace uses.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  /**
   * Filtering client-side.
   *
   * The list route supports `?niche=`/`?location=`, but this page already holds
   * the whole (small) directory, and re-fetching on every keystroke of the
   * location box would be a request per character.
   */
  const visible = useMemo(() => {
    const loc = location.trim().toLowerCase();
    return creators.filter(
      (creator) =>
        (!niche || creator.nicheCategory === niche) &&
        (!loc || (creator.location || "").toLowerCase().includes(loc))
    );
  }, [creators, niche, location]);

  const locations = useMemo(
    () =>
      Array.from(
        new Set(creators.map((creator) => (creator.location || "").trim()).filter(Boolean))
      ).sort(),
    [creators]
  );

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-20">
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-gray-200/60 bg-[var(--color-background)]/90 px-4 py-4 backdrop-blur-md sm:px-6">
        <Link
          href="/"
          aria-label="Back"
          className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        {/* The wordmark drops below sm: back arrow + wordmark + switcher +
            link overflowed a 360px viewport by 13px. */}
        <span className="sm:hidden">
          <KarigariLogo variant="dark" showWordmark={false} size={28} />
        </span>
        <span className="hidden sm:block">
          <KarigariLogo variant="dark" showWordmark={true} size={28} />
        </span>
        <div className="ml-auto flex items-center gap-2 sm:gap-3 min-w-0">
          <LanguageSwitcher />
          <Link
            href="/marketplace"
            className="text-sm font-bold text-primary hover:text-primary-dark transition-colors whitespace-nowrap"
          >
            {t("nav_marketplace")}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 sm:px-6 pt-10 pb-8">
        <div className="max-w-5xl mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 bg-[var(--color-mint)] text-primary text-[11px] font-bold px-3 py-1.5 rounded-full mb-5">
            <Sparkles size={13} /> {t("nav_creator_affiliation")}
          </span>
          <h1 className="kg-display mb-4 text-balance text-[38px] leading-[1.05] text-gray-900 sm:text-5xl lg:text-[56px]">
            {t("creators_hero_title")}
          </h1>
          <p className="text-sm sm:text-base text-gray-600 leading-relaxed max-w-2xl mx-auto">
            {t("creators_hero_subtitle")}
          </p>

          <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto text-left">
            <HeroFact icon={<ShieldCheck size={16} />} title="5% of every sale" body="Paid on delivery, direct to your own UPI." />
            <HeroFact icon={<Users size={16} />} title="No middleman" body="No approval step and no cut for anyone in between." />
            <HeroFact icon={<MousePointerClick size={16} />} title="One link" body="Share it anywhere. Clicks and sales are counted for you." />
          </div>
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        {/* Showcase */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-primary">
              {t("creators_showcase_title")}
            </h2>
            {!loading && !loadFailed && (
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {visible.length} / {creators.length}
              </p>
            )}
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                {t("creators_filter_niche")}
              </span>
              <select
                value={niche}
                onChange={(event) => setNiche(event.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">{t("creators_all")}</option>
                {CREATOR_NICHES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                {t("creators_filter_location")}
              </span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                list="creator-locations"
                placeholder={t("creators_all")}
                className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <datalist id="creator-locations">
                {locations.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>
          </div>

          {loading ? (
            <div className="py-16 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : loadFailed ? (
            <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
              {t("creators_load_failed")}
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
              {t("creators_empty")}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 kg-stagger">
              {visible.map((creator) => (
                <CreatorCard key={creator.id} creator={creator} />
              ))}
            </div>
          )}
        </section>

        {/* Registration */}
        <RegisterPanel onRegistered={load} />
      </main>
    </div>
  );
}

function HeroFact({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="kg-lift bg-card border border-gray-100 rounded-2xl p-4 shadow-card flex gap-3 items-start">
      <span className="w-8 h-8 rounded-xl bg-[var(--color-mint)] text-primary flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-primary">{title}</p>
        <p className="text-xs text-gray-600 leading-relaxed mt-0.5">{body}</p>
      </div>
    </div>
  );
}

function CreatorCard({ creator }: { creator: PublicCreator }) {
  const { t } = useLanguage();

  return (
    <article className="kg-lift kg-list-item bg-card border border-gray-100 rounded-2xl shadow-card p-5 flex flex-col hover:border-gray-200 hover:shadow-soft">
      <div className="flex items-start gap-3">
        <Avatar name={creator.name} src={creator.photoUrl} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-primary truncate">{creator.name}</h3>
          <p className="text-xs text-gray-500 truncate">@{creator.handle}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-1 rounded-md">
          {creator.nicheCategory}
        </span>
      </div>

      {creator.location && (
        <p className="text-xs text-gray-500 mt-2.5 flex items-center gap-1">
          <MapPin size={11} className="shrink-0" /> <span className="truncate">{creator.location}</span>
        </p>
      )}

      {creator.bio && (
        <p className="text-xs text-gray-600 leading-relaxed mt-2.5 line-clamp-3">{creator.bio}</p>
      )}

      <dl className="mt-auto pt-4 grid grid-cols-3 gap-2 border-t border-gray-100">
        <Stat label={t("creator_clicks")} value={String(creator.totalClicks)} />
        <Stat label={t("creator_sales")} value={String(creator.totalSales)} />
        <Stat label={t("creator_earned")} value={formatRupees(Math.round(creator.earningsTotal))} />
      </dl>

    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-sm font-bold text-primary truncate">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

function RegisterPanel({ onRegistered }: { onRegistered: () => void }) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<string>("INSTAGRAM");
  const [nicheCategory, setNicheCategory] = useState<string>(CREATOR_NICHES[0]);
  const [location, setLocation] = useState("");
  const [upiId, setUpiId] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affiliateLink, setAffiliateLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<CreatorStats | null>(null);

  const previewHandle = slugifyHandle(handle);

  const pickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (loaded) => {
      if (!loaded.target?.result) return;
      // A phone selfie is several megabytes of base64 and would travel with
      // this row on every directory load. Cap it the same way captures are.
      setPhotoUrl(await downscaleImage(loaded.target.result as string, 320, 0.8));
    };
    reader.readAsDataURL(file);
  };

  const loadStats = useCallback(async (forHandle: string) => {
    try {
      const res = await fetch(`/api/creators/stats?handle=${encodeURIComponent(forHandle)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data?.success) setStats(data.stats as CreatorStats);
    } catch (statsError) {
      console.error("Failed to load creator stats:", statsError);
    }
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/creators/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          handle,
          platform,
          nicheCategory,
          location,
          upiId,
          profileUrl,
          bio,
          photoUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error || "Could not register you right now.");
        return;
      }
      setAffiliateLink(data.affiliateUrl);
      await loadStats(data.handle);
      onRegistered();
    } catch (registerError) {
      console.error("Creator registration failed:", registerError);
      setError("Could not register you right now.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!affiliateLink) return;
    try {
      await navigator.clipboard.writeText(affiliateLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked without a secure context. The field is
      // selectable, so the link is still reachable by hand.
      setCopied(false);
    }
  };

  if (affiliateLink) {
    return (
      <aside className="bg-card border border-gray-200 rounded-2xl shadow-card p-6 lg:sticky lg:top-24">
        <div className="w-12 h-12 rounded-2xl bg-[var(--color-mint)] text-primary flex items-center justify-center mb-4">
          <Check size={24} />
        </div>
        <h2 className="text-xl font-serif font-bold text-primary mb-1">
          {stats?.name || "You're in"}
        </h2>
        <p className="text-xs text-gray-500 mb-5">@{stats?.handle || previewHandle}</p>

        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
          {t("creators_your_link")}
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={affiliateLink}
            onFocus={(event) => event.currentTarget.select()}
            className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 font-mono"
          />
          <button
            type="button"
            onClick={copyLink}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-primary hover:bg-primary-dark text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span className="hidden sm:inline">{copied ? t("creators_copied") : t("creators_copy")}</span>
          </button>
        </div>

        <dl className="grid grid-cols-3 gap-2 mt-6 pt-5 border-t border-gray-100">
          <Stat label={t("creator_clicks")} value={String(stats?.totalClicks ?? 0)} />
          <Stat label={t("creator_sales")} value={String(stats?.totalSales ?? 0)} />
          <Stat label={t("creator_earned")} value={formatRupees(stats?.earningsTotal ?? 0)} />
        </dl>

        {(stats?.pendingCommission ?? 0) > 0 && (
          <p className="text-xs text-gray-600 mt-3">
            {t("creators_pending")}: <span className="font-bold text-primary">{formatRupees(stats?.pendingCommission ?? 0)}</span>
          </p>
        )}

        {stats?.payoutUpi && (
          <p className="text-[11px] text-gray-500 mt-4 leading-relaxed">
            Commission is paid to <span className="font-mono font-bold">{stats.payoutUpi}</span> on
            delivery. Creator payout rails are not wired on this deployment, so each payout is
            recorded as a programmatic settlement rather than a confirmed bank credit.
          </p>
        )}

        <button
          type="button"
          onClick={() => stats && loadStats(stats.handle)}
          className="mt-5 w-full min-h-[44px] rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-bold text-gray-700 transition-colors"
        >
          Refresh stats
        </button>
      </aside>
    );
  }

  return (
    <aside className="bg-card border border-gray-200 rounded-2xl shadow-card p-6 lg:sticky lg:top-24">
      <h2 className="text-xl font-serif font-bold text-primary mb-1">
        {t("creators_register_title")}
      </h2>
      <p className="text-xs text-gray-600 leading-relaxed mb-5">
        Your UPI is the only place your 5% can go. No account, no password.
      </p>

      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Your name" required>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
            placeholder="Shreya Nayak"
          />
        </Field>

        <Field label="Handle" required hint={previewHandle ? `Your link: /marketplace?ref=${previewHandle}` : undefined}>
          <input
            required
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            className={inputClass}
            placeholder="shreya_styles"
          />
        </Field>


        <Field label="Craft you promote" required>
          <select
            value={nicheCategory}
            onChange={(event) => setNicheCategory(event.target.value)}
            className={inputClass}
          >
            {CREATOR_NICHES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Location">
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className={inputClass}
            placeholder="Bhubaneswar, Odisha"
          />
        </Field>

        <Field label="UPI ID" required hint="Where your 5% is paid on delivery.">
          <input
            required
            value={upiId}
            onChange={(event) => setUpiId(event.target.value)}
            className={inputClass}
            placeholder="name@bank"
            inputMode="email"
            autoComplete="off"
          />
        </Field>


        <Field label="Photo">
          <div className="flex items-center gap-3">
            <Avatar name={name} src={photoUrl} size={44} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={pickPhoto}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="min-h-[44px] px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-bold text-gray-700 flex items-center gap-1.5 transition-colors"
            >
              <Upload size={14} /> {photoUrl ? "Change" : "Upload"}
            </button>
          </div>
        </Field>

        <Field label="About you">
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={3}
            className={cn(inputClass, "py-2.5 resize-y")}
            placeholder="I post handloom styling reels for a Bhubaneswar audience."
          />
        </Field>

        {error && (
          <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[48px] rounded-xl bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          {t("creators_register_cta")}
        </button>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          The 5% comes out of Karigari&rsquo;s own share, never the artisan&rsquo;s. Payouts are
          recorded on delivery as programmatic settlements — no payout rail is wired on this
          deployment, so no bank credit is claimed.
        </p>
      </form>
    </aside>
  );
}

const inputClass =
  "w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-gray-500 mt-1 break-all">{hint}</span>}
    </label>
  );
}
