"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Eye,
  Landmark,
  Link2,
  Loader2,
  QrCode,
  ReceiptIndianRupee,
  ShieldCheck,
  ShoppingBag,
  Truck,
  X,
} from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading, SectionLabel } from "@/components/ui/SectionLabel";
import { MIN_EVENTS_FOR_SCORE, type CreditProfile } from "@/lib/creditScore";
import { MAX_SHARED_WITH_LENGTH } from "@/lib/creditShare";
import {
  CreditComponentList,
  CreditDisclaimer,
  CreditFormula,
  CreditGauge,
  fill,
  num,
} from "@/components/CreditRecordParts";

/**
 * The artisan's production record: a 300–900 score built only from what
 * happened on Karigari, how it was calculated, and a frozen link they can hand
 * to a loan officer.
 *
 * `compact` sits on the dashboard under Trust & Reports; `full` is the Credit
 * record tab of Earnings. Below the eligibility threshold neither variant shows
 * a gauge or a number — only what is missing.
 */

interface ActiveShare {
  id: string;
  url: string;
  sharedWith: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

interface CreditPayload {
  profile: CreditProfile;
  shares: ActiveShare[];
  limits: { maxActiveShares: number; defaultDays: number; maxDays: number; dayOptions: number[] };
}

const IST_DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" };
const istDay = (iso: string) => new Date(iso).toLocaleString("en-IN", IST_DAY);

/** Server refusal codes → the sentence the artisan reads. */
const SHARE_ERROR_KEY: Record<string, string> = {
  SHARE_LIMIT: "credit_share_limit",
  NOT_ELIGIBLE: "credit_share_disabled",
  BAD_DAYS: "credit_share_failed",
};

export function CreditProfileCard({ variant = "full" }: { variant?: "compact" | "full" }) {
  const { t } = useLanguage();
  const [data, setData] = useState<CreditPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/artisan/credit-profile", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as CreditPayload);
      setState("ready");
    } catch (error) {
      console.warn("[credit-profile] unavailable:", (error as Error)?.message);
      setState("failed");
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const compact = variant === "compact";

  const heading = compact ? (
    <SectionHeading id="credit-heading" size="md">
      {t("credit_title")}
    </SectionHeading>
  ) : (
    <div>
      <SectionHeading id="credit-heading" rule>
        {t("credit_title")}
      </SectionHeading>
      <p className="-mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-500">{t("credit_lede")}</p>
    </div>
  );

  let body: React.ReactNode;
  if (state === "loading") {
    body = (
      <div aria-busy="true" className={cn("kg-shimmer rounded-2xl", compact ? "h-[220px]" : "h-[420px]")} />
    );
  } else if (state === "failed" || !data) {
    body = (
      <Card pad="lg" className="border-dashed text-center" role="alert">
        <p className="text-[14px] text-gray-600">{t("credit_load_failed")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="kg-press mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
        >
          {t("retry")}
        </button>
      </Card>
    );
  } else if (compact) {
    body = <CompactRecord profile={data.profile} />;
  } else {
    body = (
      <FullRecord
        data={data}
        onShareCreated={(share) =>
          setData((current) => (current ? { ...current, shares: [share, ...current.shares] } : current))
        }
        onShareRevoked={(id) =>
          setData((current) => (current ? { ...current, shares: current.shares.filter((s) => s.id !== id) } : current))
        }
      />
    );
  }

  return (
    <section aria-labelledby="credit-heading" className={compact ? "mt-12" : "space-y-8"}>
      {heading}
      {body}
    </section>
  );
}

// ---------------------------------------------------------------- compact

function CompactRecord({ profile }: { profile: CreditProfile }) {
  const { t } = useLanguage();
  return (
    <Card pad="lg" className="kg-enter">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {profile.eligible && profile.score !== null && profile.band ? (
          <div className="sm:w-[240px] sm:shrink-0">
            <CreditGauge score={profile.score} band={profile.band} compact />
          </div>
        ) : (
          <div className="sm:w-[240px] sm:shrink-0">
            <EligibilityProgress profile={profile} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-[14px] leading-relaxed text-gray-600">{t("credit_lede")}</p>
          <CreditDisclaimer />
          <Link
            href="/artisan/earnings?tab=credit"
            className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
          >
            {t("credit_open_full")} <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------- full

function FullRecord({
  data,
  onShareCreated,
  onShareRevoked,
}: {
  data: CreditPayload;
  onShareCreated: (share: ActiveShare) => void;
  onShareRevoked: (id: string) => void;
}) {
  const { t } = useLanguage();
  const { profile } = data;
  const scored = profile.eligible && profile.score !== null && profile.band !== null;

  return (
    <div className="space-y-8">
      <Card pad="lg" className="kg-enter">
        {scored ? (
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="md:w-[300px] md:shrink-0">
              <CreditGauge score={profile.score as number} band={profile.band!} />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <p className="text-[14px] leading-relaxed text-gray-600">
                {fill(t("credit_computed_at"), { date: istDay(profile.computedAt) })}
              </p>
              <CreditDisclaimer />
            </div>
          </div>
        ) : (
          <IneligiblePanel profile={profile} />
        )}
      </Card>

      {scored && (
        <>
          <section aria-labelledby="credit-components">
            <SectionLabel>
              <span id="credit-components">{t("credit_components_title")}</span>
            </SectionLabel>
            <Card pad="lg">
              <CreditComponentList profile={profile} />
            </Card>
          </section>

          <details className="group rounded-2xl border border-gray-200 bg-white">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[14px] font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
              {t("credit_how_calculated")}
              <ChevronDown size={18} className="shrink-0 text-gray-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-gray-100 px-5 py-4">
              <CreditFormula profile={profile} />
            </div>
          </details>
        </>
      )}

      <SharePanel data={data} onShareCreated={onShareCreated} onShareRevoked={onShareRevoked} />
    </div>
  );
}

/** The four kinds of event that count toward eligibility, with where to make more of each. */
function eventRows(profile: CreditProfile) {
  const i = profile.inputs;
  return [
    { key: "verified", labelKey: "credit_event_verified", n: i.verifiedListings, href: "/artisan/market", icon: <ShieldCheck size={16} /> },
    { key: "sold", labelKey: "credit_event_sold", n: i.soldCount, href: "/artisan/market", icon: <ShoppingBag size={16} /> },
    { key: "orders", labelKey: "credit_event_orders", n: i.ordersAccepted, href: "/artisan/orders", icon: <Truck size={16} /> },
    { key: "offline", labelKey: "credit_event_offline", n: i.offlineSalesCount, href: "/artisan/log-sale", icon: <ReceiptIndianRupee size={16} /> },
  ];
}

function EligibilityProgress({ profile }: { profile: CreditProfile }) {
  const { t } = useLanguage();
  const missing = Math.max(0, MIN_EVENTS_FOR_SCORE - profile.eventCount);
  return (
    <div>
      <p className="kg-display text-[20px] leading-snug text-gray-900">{t("credit_insufficient_title")}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
        {fill(t("credit_insufficient_short"), { n: num(profile.eventCount), min: MIN_EVENTS_FOR_SCORE })}
      </p>
      <ProgressBar
        value={profile.eventCount}
        max={MIN_EVENTS_FOR_SCORE}
        label={t("credit_insufficient_title")}
        className="mt-3"
      />
      <p className="mt-2 text-[12px] font-semibold text-[var(--color-maroon)]">
        {fill(t("credit_need_more"), { n: missing })}
      </p>
    </div>
  );
}

function IneligiblePanel({ profile }: { profile: CreditProfile }) {
  const { t } = useLanguage();
  const missing = Math.max(0, MIN_EVENTS_FOR_SCORE - profile.eventCount);
  return (
    <div className="space-y-5">
      <div>
        <p className="kg-display text-[24px] leading-snug text-gray-900">{t("credit_insufficient_title")}</p>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
          {fill(t("credit_insufficient_body"), { min: MIN_EVENTS_FOR_SCORE, n: num(profile.eventCount) })}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={profile.eventCount} max={MIN_EVENTS_FOR_SCORE} label={t("credit_insufficient_title")} />
          <span className="shrink-0 font-mono text-[12px] text-gray-600">
            {num(profile.eventCount)}/{MIN_EVENTS_FOR_SCORE}
          </span>
        </div>
        <p className="mt-2 text-[13px] font-semibold text-[var(--color-maroon)]">{fill(t("credit_need_more"), { n: missing })}</p>
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {eventRows(profile).map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className="kg-press flex min-h-[56px] items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-gray-300"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-pill)] text-gray-700">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-gray-800">{t(row.labelKey)}</span>
              <span className="kg-display shrink-0 text-[22px] text-gray-900">{num(row.n)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <CreditDisclaimer />
    </div>
  );
}

// ------------------------------------------------------------------ share

function SharePanel({
  data,
  onShareCreated,
  onShareRevoked,
}: {
  data: CreditPayload;
  onShareCreated: (share: ActiveShare) => void;
  onShareRevoked: (id: string) => void;
}) {
  const { t } = useLanguage();
  const { profile, shares, limits } = data;
  const [open, setOpen] = useState(false);
  const [sharedWith, setSharedWith] = useState("");
  const [days, setDays] = useState(limits.defaultDays);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  // A first tap on Revoke arms it; the arm lapses after a few seconds so a
  // forgotten tap cannot revoke a link much later.
  useEffect(() => {
    if (!confirmId) return;
    const lapse = setTimeout(() => setConfirmId(null), 4000);
    return () => clearTimeout(lapse);
  }, [confirmId]);

  useEffect(() => {
    if (!copiedId) return;
    const lapse = setTimeout(() => setCopiedId(null), 2500);
    return () => clearTimeout(lapse);
  }, [copiedId]);

  const atLimit = shares.length >= limits.maxActiveShares;
  const selected = shares.find((share) => share.id === selectedId) ?? null;

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/artisan/credit-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedWith, expiresInDays: days }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const key = SHARE_ERROR_KEY[json?.code as string] ?? "credit_share_failed";
        setMessage({ tone: "error", text: fill(t(key), { max: limits.maxActiveShares }) });
        return;
      }
      const share = json.share as ActiveShare;
      onShareCreated(share);
      setSelectedId(share.id);
      setJustCreatedId(share.id);
      setOpen(false);
      setSharedWith("");
      setMessage(null);
    } catch {
      setMessage({ tone: "error", text: t("credit_share_failed") });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/artisan/credit-profile?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      // 404 means it was already revoked elsewhere: either way it is gone.
      if (!res.ok && res.status !== 404) throw new Error(json?.error || `HTTP ${res.status}`);
      onShareRevoked(id);
      if (selectedId === id) setSelectedId(null);
      setMessage({ tone: "ok", text: t("credit_share_revoked") });
    } catch {
      setMessage({ tone: "error", text: t("credit_share_revoke_failed") });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (share: ActiveShare) => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopiedId(share.id);
    } catch {
      linkInput.current?.select();
      setMessage({ tone: "error", text: t("credit_share_copy_failed") });
    }
  };

  return (
    <section aria-labelledby="credit-share" className="space-y-4">
      <SectionLabel>
        <span id="credit-share">{t("credit_share_title")}</span>
      </SectionLabel>

      <Card pad="lg" className="space-y-5">
        <p className="max-w-2xl text-[14px] leading-relaxed text-gray-600">{t("credit_share_lede")}</p>

        {!profile.eligible ? (
          <div className="space-y-2">
            <button
              type="button"
              disabled
              aria-describedby="credit-share-disabled"
              className="inline-flex min-h-[44px] cursor-not-allowed items-center gap-2 rounded-xl bg-gray-200 px-5 text-[13px] font-semibold text-gray-500"
            >
              <Landmark size={15} /> {t("credit_share_cta")}
            </button>
            <p id="credit-share-disabled" className="text-[13px] text-gray-600">
              {t("credit_share_disabled")}
            </p>
          </div>
        ) : atLimit ? (
          <p className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-[13px] text-orange-800">
            {fill(t("credit_share_limit"), { max: limits.maxActiveShares })}
          </p>
        ) : !open ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setMessage(null);
            }}
            className="kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark"
          >
            <Landmark size={15} /> {t("credit_share_cta")}
          </button>
        ) : (
          <form
            className="space-y-4 rounded-xl border border-gray-200 bg-[var(--color-gray-50)] p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div>
              <label htmlFor="credit-share-for" className="mb-2 block text-[13px] font-semibold text-gray-800">
                {t("credit_share_for")} <span className="font-normal text-gray-400">· {t("log_sale_optional")}</span>
              </label>
              <input
                id="credit-share-for"
                type="text"
                value={sharedWith}
                maxLength={MAX_SHARED_WITH_LENGTH}
                placeholder={t("credit_share_for_placeholder")}
                onChange={(event) => setSharedWith(event.target.value)}
                className="block h-[50px] w-full rounded-xl border border-gray-200 bg-white px-4 text-[15px] text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
            <fieldset className="min-w-0">
              <legend className="mb-2 block text-[13px] font-semibold text-gray-800">{t("credit_share_days")}</legend>
              <div className="flex flex-wrap gap-2">
                {limits.dayOptions.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "kg-press inline-flex min-h-[44px] cursor-pointer items-center rounded-full px-4 text-[13px] font-semibold",
                      days === option ? "bg-primary text-white" : "bg-[var(--color-pill)] text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    <input
                      type="radio"
                      name="credit-share-days"
                      value={option}
                      checked={days === option}
                      onChange={() => setDays(option)}
                      className="sr-only"
                    />
                    {fill(t("credit_share_days_option"), { n: option })}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy}
                className={cn(
                  "kg-press inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 text-[13px] font-semibold text-white hover:bg-primary-dark",
                  busy && "cursor-not-allowed opacity-60"
                )}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} {t("credit_share_create")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="kg-press inline-flex min-h-[44px] items-center rounded-xl bg-white px-5 text-[13px] font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        )}

        <div role="status" aria-live="polite">
          {message && (
            <p
              className={cn(
                "rounded-xl border px-4 py-3 text-[13px]",
                message.tone === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-100 bg-red-50 text-red-800"
              )}
            >
              {message.text}
            </p>
          )}
        </div>

        {selected && (
          <div className="kg-fade grid gap-5 rounded-xl border border-gray-200 p-4 sm:grid-cols-[auto,1fr] sm:items-start">
            <div className="mx-auto rounded-xl bg-white p-3 ring-1 ring-gray-200 sm:mx-0">
              <QRCode value={selected.url} size={152} aria-label={t("credit_share_qr_label")} role="img" />
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-semibold text-gray-900">
                  {selected.sharedWith
                    ? fill(t("credit_share_for_label"), { who: selected.sharedWith })
                    : t("credit_share_unnamed")}
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label={t("credit_share_hide")}
                  className="kg-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              </div>
              {justCreatedId === selected.id && (
                <p className="text-[13px] leading-relaxed text-gray-600">{t("credit_share_created")}</p>
              )}
              <label htmlFor="credit-share-url" className="sr-only">
                {t("credit_share_link_label")}
              </label>
              <div className="flex gap-2">
                <input
                  id="credit-share-url"
                  ref={linkInput}
                  readOnly
                  value={selected.url}
                  onFocus={(event) => event.target.select()}
                  className="block h-[44px] min-w-0 flex-1 rounded-xl border border-gray-200 bg-[var(--color-gray-50)] px-3 font-mono text-[12px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
                <button
                  type="button"
                  onClick={() => void copy(selected)}
                  className="kg-press inline-flex h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-white hover:bg-primary-dark"
                >
                  {copiedId === selected.id ? <Check size={15} /> : <Copy size={15} />}
                  {copiedId === selected.id ? t("credit_share_copied") : t("credit_share_copy")}
                </button>
              </div>
              <p className="text-[12px] text-gray-500">{fill(t("credit_share_expires"), { date: istDay(selected.expiresAt) })}</p>
            </div>
          </div>
        )}

        <div>
          <p className="kg-label mb-2 font-medium text-gray-500">{t("credit_share_active_title")}</p>
          {shares.length === 0 ? (
            <p className="text-[13px] text-gray-500">{t("credit_share_none")}</p>
          ) : (
            <ul className="space-y-2.5">
              {shares.map((share) => (
                <li key={share.id} className="rounded-xl border border-gray-200 bg-white p-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-gray-900 [overflow-wrap:anywhere]">
                        {share.sharedWith || t("credit_share_unnamed")}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-gray-500">
                        {fill(t("credit_share_made"), { date: istDay(share.createdAt) })} ·{" "}
                        {fill(t("credit_share_expires"), { date: istDay(share.expiresAt) })}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[12px] text-gray-600">
                        <Eye size={13} aria-hidden />
                        {fill(t("credit_share_views"), { n: share.viewCount })}
                        {share.lastViewedAt && ` · ${fill(t("credit_share_last_viewed"), { date: istDay(share.lastViewedAt) })}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(share.id === selectedId ? null : share.id)}
                        aria-pressed={share.id === selectedId}
                        className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--color-pill)] px-3 text-[12px] font-semibold text-gray-800 hover:bg-gray-200"
                      >
                        <QrCode size={14} /> {t("credit_share_show")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void revoke(share.id)}
                        disabled={busy}
                        className={cn(
                          "kg-press inline-flex min-h-[40px] items-center rounded-xl px-3 text-[12px] font-semibold",
                          confirmId === share.id
                            ? "bg-[var(--color-maroon)] text-white"
                            : "text-red-700 ring-1 ring-red-100 hover:bg-red-50",
                          busy && "cursor-not-allowed opacity-60"
                        )}
                      >
                        {confirmId === share.id ? t("credit_share_revoke_confirm") : t("credit_share_revoke")}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}
