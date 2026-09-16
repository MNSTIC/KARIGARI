"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/translations";
import { upcomingFestivals } from "@/lib/festivals";
import { useOfflineQueue, refreshQueueCount } from "@/lib/offlineQueueStore";
import { flushQueue } from "@/lib/offlineSync";
import styles from "./NotificationTicker.module.css";

/**
 * Three faint strips that glide across the top of the artisan dashboard.
 *
 *   1. MARKET INSIGHT  the nearest festival (craft-matched when possible) —
 *                      opens the festival calendar, which lists the artisan's
 *                      own pieces to push for each event.
 *   2. SYNC STATUS     offline / syncing / waiting on this phone / last synced —
 *                      tapping it runs a sync now.
 *   3. DELIVERY        the newest "a buyer received your piece" alert, else the
 *                      newest sale, else a quiet pointer to Orders.
 *
 * Every line is derived from real state; nothing is a canned demo string. The
 * motion itself lives in NotificationTicker.module.css.
 */

interface Alert {
  type: string;
  createdAt: string;
}

interface CalendarEvent {
  name: string;
  daysAway: number;
  matchesCraft: boolean;
}

const TICK_MS = 30_000;

export function NotificationTicker() {
  const { t } = useLanguage();
  const { online, queued, syncing } = useOfflineQueue();

  const [festival, setFestival] = useState<string | null>(() => upcomingFestivals({ withinDays: 365 })[0]?.name ?? null);
  const [delivery, setDelivery] = useState<"delivered" | "purchased" | "none">("none");
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/artisan/notifications", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.success) return;

      const alerts: Alert[] = Array.isArray(data.notifications) ? data.notifications : [];
      // Newest first from the API, so the first hit of each type is the latest.
      if (alerts.some((a) => a.type === "ORDER_DELIVERED")) setDelivery("delivered");
      else if (alerts.some((a) => a.type === "PURCHASE")) setDelivery("purchased");
      else setDelivery("none");

      const calendar: CalendarEvent[] = Array.isArray(data.calendar) ? data.calendar : [];
      const next = calendar.find((event) => event.matchesCraft) ?? calendar[0];
      if (next?.name) setFestival(next.name);

      // A successful round-trip to the server is what "synced" means here.
      setSyncedAt(Date.now());
    } catch {
      // Offline or a dropped request: the strips keep their last known state.
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(load, 0);
    const clock = setInterval(() => setNow(Date.now()), TICK_MS);
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(kickoff);
      clearInterval(clock);
      window.removeEventListener("online", onOnline);
    };
  }, [load]);

  // A finished upload counts as a sync too.
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) void load();
    wasSyncing.current = syncing;
  }, [syncing, load]);

  const syncNow = async () => {
    await flushQueue().catch(() => undefined);
    await refreshQueueCount().catch(() => 0);
    await load();
  };

  // ---- copy ---------------------------------------------------------------
  const insight = festival ? (
    <>
      <span className={styles.lead}>{t("ticker_festival_coming").replace("{festival}", festival)}</span>
      <span>{t("ticker_festival_cta")}</span>
    </>
  ) : (
    <span>{t("ticker_insight_generic")}</span>
  );

  let syncText: string;
  if (!online) syncText = t("ticker_offline");
  else if (syncing) syncText = t("ticker_syncing").replace("{n}", String(queued));
  else if (queued > 0) syncText = t("ticker_waiting").replace("{n}", String(queued));
  else if (syncedAt === null) syncText = t("ticker_checking_sync");
  else {
    const minutes = Math.floor((now - syncedAt) / 60_000);
    syncText =
      minutes < 1
        ? t("ticker_synced_now")
        : minutes === 1
          ? t("ticker_synced_one_min")
          : minutes < 60
            ? t("ticker_synced_mins").replace("{n}", String(minutes))
            : t("ticker_synced_hours").replace("{n}", String(Math.floor(minutes / 60)));
  }

  const deliveryText =
    delivery === "delivered"
      ? t("ticker_delivered")
      : delivery === "purchased"
        ? t("ticker_purchased")
        : t("ticker_orders_clear");

  const arrow = (
    <span className={styles.arrow} aria-hidden="true">
      →
    </span>
  );

  // ---- equal strip widths -------------------------------------------------
  // Every lane must travel the same distance in the same time, or the three
  // would drift apart. The widest strip sets the width for all of them.
  const tickerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fingerprint = `${festival}|${syncText}|${deliveryText}`;

  useLayoutEffect(() => {
    const ticker = tickerRef.current;
    const measure = measureRef.current;
    if (!ticker || !measure) return;
    const apply = () => {
      const widest = Math.max(
        0,
        ...Array.from(measure.children).map((child) => Math.ceil((child as HTMLElement).getBoundingClientRect().width))
      );
      const minShare = Number(getComputedStyle(ticker).getPropertyValue("--ticker-strip-min")) || 0;
      const width = Math.max(widest, Math.round(ticker.clientWidth * minShare));
      if (width > 0) ticker.style.setProperty("--ticker-strip-width", `${width}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(ticker);
    return () => observer.disconnect();
  }, [fingerprint]);

  const insightStrip = (
    <>
      {insight}
      {arrow}
    </>
  );
  const syncStrip = (
    <>
      <span>{syncText}</span>
      <span aria-hidden="true">···</span>
      {arrow}
    </>
  );
  const deliveryStrip = (
    <>
      <span>{deliveryText}</span>
      {arrow}
    </>
  );

  return (
    <div ref={tickerRef} className={styles.ticker} role="region" aria-label={t("ticker_region_label")}>
      <div className={styles.lane}>
        <div className={styles.track}>
          <Link href="/artisan/notifications" className={`${styles.strip} ${styles.insight}`}>
            {insightStrip}
          </Link>
        </div>
      </div>
      <div className={styles.lane}>
        <div className={styles.track}>
          <button
            type="button"
            onClick={syncNow}
            className={`${styles.strip} ${styles.sync}`}
            aria-label={`${syncText}. ${t("ticker_sync_now")}`}
          >
            {syncStrip}
          </button>
        </div>
      </div>
      <div className={styles.lane}>
        <div className={styles.track}>
          <Link href="/artisan/orders" className={`${styles.strip} ${styles.delivery}`}>
            {deliveryStrip}
          </Link>
        </div>
      </div>

      <div ref={measureRef} className={styles.measure} aria-hidden="true">
        <span className={styles.strip} style={{ width: "max-content" }}>{insightStrip}</span>
        <span className={styles.strip} style={{ width: "max-content" }}>{syncStrip}</span>
        <span className={styles.strip} style={{ width: "max-content" }}>{deliveryStrip}</span>
      </div>
    </div>
  );
}
