"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  CheckCheck,
  Loader2,
  Megaphone,
  Package,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { useLanguage } from "@/lib/translations";
import { formatRupees } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * The artisan's notifications view.
 *
 * Two halves, both driven entirely by real data:
 *   1. An upcoming-events calendar built from the shared festival table, with
 *      the artisan's OWN listed pieces attached to each event — so the answer
 *      to "Durga Puja is in three weeks" is immediately "and these two of your
 *      listings are the ones to push".
 *   2. Their real Notification rows (demand alerts, scheme updates).
 */

interface CalendarProduct {
  id: string;
  craftType: string;
  image: string | null;
  price: number | null;
}

interface CalendarEvent {
  key: string;
  name: string;
  date: string;
  daysAway: number;
  demandNote: string;
  matchesCraft: boolean;
  products: CalendarProduct[];
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  channel: string;
  read: boolean;
  createdAt: string;
}

/** Pinned zone so the date does not shift between server and client render. */
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", DATE_FORMAT);
}

export default function NotificationsPage() {
  const { t } = useLanguage();

  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/artisan/notifications", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        setCalendar(data.calendar || []);
        setNotifications(data.notifications || []);
        setUnread(data.unreadCount || 0);
      } else {
        setFailed(true);
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the other artisan pages use.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const markAllRead = async () => {
    try {
      await fetch("/api/artisan/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch (error) {
      console.error("Failed to mark read:", error);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans pb-16">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link
          href="/artisan/dashboard"
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-700" />
        </Link>
        <KarigariLogo variant="dark" showWordmark={true} size={28} />
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-primary flex items-center gap-3">
              <BellRing size={26} className="text-primary-light" />
              {t("notifications_title")}
            </h1>
            <p className="text-gray-600 mt-2 text-sm">{t("notifications_subtitle")}</p>
          </div>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center justify-center gap-2 text-sm font-bold text-primary border border-[var(--color-sage)] rounded-xl px-4 py-2.5 hover:bg-[var(--color-mint)] transition-colors shrink-0"
            >
              <CheckCheck size={16} /> {t("mark_all_read")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-20 flex justify-center">
            <Loader2 size={28} className="animate-spin text-primary" />
          </div>
        ) : failed ? (
          <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
            {t("notifications_load_failed")}
          </p>
        ) : (
          <div className="space-y-10">
            {/* ---------------- Upcoming events ---------------- */}
            <section>
              <h2 className="text-lg font-serif font-bold text-primary mb-1 flex items-center gap-2">
                <CalendarDays size={18} className="text-primary-light" />
                {t("upcoming_events")}
              </h2>
              <p className="text-xs text-gray-500 mb-4">{t("upcoming_events_hint")}</p>

              {calendar.length === 0 ? (
                <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
                  {t("no_upcoming_events")}
                </p>
              ) : (
                <div className="space-y-4">
                  {calendar.map((event) => (
                    <article
                      key={event.key}
                      className={cn(
                        "bg-card rounded-2xl border shadow-card overflow-hidden",
                        event.matchesCraft
                          ? "border-[var(--color-sage)]"
                          : "border-gray-100"
                      )}
                    >
                      <div className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <h3 className="font-serif font-bold text-lg text-primary flex items-center gap-2 flex-wrap">
                              {event.name}
                              {event.matchesCraft && (
                                <span className="inline-flex items-center gap-1 bg-[var(--color-mint)] text-primary text-[10px] font-bold px-2 py-0.5 rounded-full border border-[var(--color-sage)]">
                                  <Sparkles size={10} /> {t("lifts_your_craft")}
                                </span>
                              )}
                            </h3>
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mt-1">
                              {formatDate(event.date)}
                            </p>
                          </div>

                          {/* Countdown chip — the closer it is, the louder. */}
                          <span
                            className={cn(
                              "text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap shrink-0",
                              event.daysAway <= 14
                                ? "bg-primary text-white"
                                : "bg-gray-100 text-gray-600"
                            )}
                          >
                            {event.daysAway === 0
                              ? t("today")
                              : `${event.daysAway} ${t("days_away")}`}
                          </span>
                        </div>

                        <p className="text-sm text-gray-600 leading-relaxed flex gap-2 items-start">
                          <TrendingUp size={14} className="shrink-0 mt-0.5 text-primary-light" />
                          {event.demandNote}
                        </p>
                      </div>

                      {/* The artisan's own matching stock for this event. */}
                      {event.products.length > 0 ? (
                        <div className="border-t border-gray-100 bg-[var(--color-mint)]/25 p-5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-primary mb-3">
                            {t("your_pieces_for_this")}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {event.products.map((product) => (
                              <Link
                                key={product.id}
                                href={`/marketplace/product/${product.id}`}
                                className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-3 hover:border-[var(--color-sage)] transition-colors"
                              >
                                <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                                  {product.image ? (
                                    <Image
                                      src={product.image}
                                      alt={product.craftType}
                                      fill
                                      sizes="56px"
                                      unoptimized={product.image.startsWith("data:")}
                                      className="object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                      <Package size={18} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-primary truncate">
                                    {product.craftType}
                                  </p>
                                  {/* font-sans: ₹ is absent from the serif face. */}
                                  <p className="text-xs font-bold text-gray-700 font-sans">
                                    {formatRupees(product.price)}
                                  </p>
                                </div>
                                <span className="text-[11px] font-bold text-primary whitespace-nowrap shrink-0">
                                  {t("view_listing")} →
                                </span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="border-t border-gray-100 px-5 py-4">
                          <p className="text-xs text-gray-500 italic">
                            {t("no_matching_pieces")}{" "}
                            <Link
                              href="/artisan/market?tab=syndication"
                              className="font-bold text-primary underline underline-offset-4"
                            >
                              {t("list_on_ondc")}
                            </Link>
                          </p>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* ---------------- Real alerts ---------------- */}
            <section>
              <h2 className="text-lg font-serif font-bold text-primary mb-4 flex items-center gap-2 border-b border-gray-200 pb-2">
                <Megaphone size={18} className="text-primary-light" />
                {t("your_alerts")}
              </h2>

              {notifications.length === 0 ? (
                <p className="text-sm text-gray-500 italic bg-card border border-dashed border-gray-200 rounded-2xl p-8 text-center">
                  {t("no_alerts")}
                </p>
              ) : (
                <div className="space-y-3">
                  {notifications.map((note) => (
                    <div
                      key={note.id}
                      className={cn(
                        "bg-card rounded-2xl border shadow-card p-4 flex gap-3 items-start",
                        note.read ? "border-gray-100" : "border-[var(--color-sage)]"
                      )}
                    >
                      <div
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                          note.read
                            ? "bg-gray-100 text-gray-400"
                            : "bg-[var(--color-mint)] text-primary"
                        )}
                      >
                        <BellRing size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-primary">{note.title}</p>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {note.channel}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed mt-1">
                          {note.message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
