"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PackageSearch, Landmark, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { SUPPLY_IDLE_DAYS, type SupplyReason } from "@/lib/supplyReminderRules";
import { Card } from "@/components/ui/Card";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { fill } from "@/components/buyer/passportFormat";

/**
 * The inline restock nudge on the dashboard.
 *
 * Calm on purpose: a muted card above the captures list, not a modal, not red.
 * The artisan has not done anything wrong — they have been busy, or ill, or out
 * of material, and the two things that usually unblock them (verified raw
 * material, credit schemes) each have a page here.
 *
 * Every figure comes from `supplyStatus` in the dashboard payload, which is the
 * same decision the notification uses, so the card and the bell always agree.
 *
 * Two ways to quiet it, and they are different on purpose:
 *   "Remind me later" writes a snooze on the account (no reminder for a week,
 *   on any device);
 *   "Dismiss" only hides the card on this phone, and it comes back once the
 *   artisan has been idle a week longer — the account state is untouched.
 */

/** Per-device dismissal. Never sent anywhere; see the note above. */
const DISMISS_KEY = "karigari_supply_nudge_dismissed";
const DISMISS_IDLE_GRACE_DAYS = 7;

export interface SupplyStatus {
  idleDays: number | null;
  lastActivityAt: string | null;
  reason: SupplyReason;
  snoozedUntil: string | null;
}

function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const days = raw === null ? NaN : Number(raw);
    return Number.isFinite(days) ? days : null;
  } catch {
    // Storage blocked (private mode): the card simply cannot be dismissed.
    return null;
  }
}

export function SupplyNudgeCard({
  status,
  onSnoozed,
}: {
  status: SupplyStatus | null | undefined;
  /** Called after a successful snooze so the dashboard can drop the card. */
  onSnoozed?: () => void;
}) {
  const { t } = useLanguage();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const idleDays = status?.idleDays ?? null;

  useEffect(() => {
    if (idleDays === null) return;
    const kickoff = setTimeout(() => {
      const dismissedAt = readDismissedAt();
      if (dismissedAt !== null && idleDays - dismissedAt < DISMISS_IDLE_GRACE_DAYS) setHidden(true);
    }, 0);
    return () => clearTimeout(kickoff);
  }, [idleDays]);

  if (!status || idleDays === null || idleDays < SUPPLY_IDLE_DAYS || hidden) return null;
  // A snooze, a brand-new account and a missing profile are all reasons not to
  // be told anything at all.
  if (status.reason === "SNOOZED" || status.reason === "TOO_NEW" || status.reason === "NO_PROFILE") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(idleDays));
    } catch {
      /* Hidden for this view either way. */
    }
    setHidden(true);
  };

  const snooze = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/artisan/supply-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snooze" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(`supply-reminder ${res.status}`);
      setHidden(true);
      onSnoozed?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const lastActivity = status.lastActivityAt
    ? new Date(status.lastActivityAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : null;

  return (
    <Card tone="muted" pad="lg" className="kg-enter">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-gray-700">
          <PackageSearch size={18} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SectionEyebrow>{fill(t("supply_nudge_days"), { days: idleDays })}</SectionEyebrow>
          </div>
          <h3 className="kg-display mt-1 text-[20px] leading-snug text-gray-900">
            {fill(t("supply_nudge_title"), { days: idleDays })}
          </h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-gray-600">{t("supply_nudge_body")}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
            {lastActivity ? fill(t("supply_nudge_since"), { date: lastActivity }) : t("supply_nudge_since_never")}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/artisan/materials"
              className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-white hover:bg-primary-dark"
            >
              <PackageSearch size={14} aria-hidden /> {t("supply_nudge_browse_suppliers")}
            </Link>
            <Link
              href="/artisan/schemes"
              className="kg-press inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 bg-card px-3.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50"
            >
              <Landmark size={14} aria-hidden /> {t("supply_nudge_schemes")}
            </Link>
            <button
              type="button"
              onClick={snooze}
              disabled={busy}
              className="kg-press inline-flex min-h-[40px] items-center rounded-lg px-3 text-[13px] font-medium text-gray-600 underline underline-offset-2 disabled:opacity-60"
            >
              {t("supply_nudge_snooze")}
            </button>
          </div>
          {failed && (
            <p role="alert" className="mt-2 text-[12px] text-red-700">
              {t("supply_nudge_snooze_failed")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("supply_nudge_dismiss")}
          className="kg-press -m-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-900"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </Card>
  );
}
