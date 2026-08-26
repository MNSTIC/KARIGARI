"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, MessageCircle, TrendingUp, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/translations";

/**
 * Header bell backed by real `Notification` rows.
 *
 * The same rows drive the WhatsApp/SMS simulation, so the parent can lift them
 * out through `onNotifications` instead of fetching the list a second time.
 */

export interface ArtisanNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  relatedDemandId: string | null;
  channel: string | null;
  createdAt: string;
}

/** Non-DB alerts the host page already knows about (e.g. a flagged listing). */
export interface LocalAlert {
  id: string;
  title: string;
  message: string;
}

function iconFor(type: string) {
  if (type === "DEMAND_ALERT") return <TrendingUp size={14} />;
  if (type === "FESTIVAL") return <CalendarDays size={14} />;
  if (type === "SCHEME") return <MessageCircle size={14} />;
  return <Bell size={14} />;
}

function relativeTime(iso: string, t: (k: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return t("just_now");
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function NotificationsBell({
  onNotifications,
  localAlerts = [],
}: {
  onNotifications?: (list: ArtisanNotification[]) => void;
  localAlerts?: LocalAlert[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ArtisanNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so `load` stays stable while still reaching the latest prop.
  const notify = useRef(onNotifications);
  useEffect(() => {
    notify.current = onNotifications;
  }, [onNotifications]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/artisan/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
      notify.current?.(data.notifications ?? []);
    } catch (e) {
      console.error("Failed to load notifications", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — same pattern the schemes page uses.
    const kickoff = setTimeout(load, 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  // Click-outside closes the panel; without it the dropdown traps the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await fetch("/api/artisan/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch((e) => console.error("Failed to mark notification read", e));
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await fetch("/api/artisan/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch((e) => console.error("Failed to mark notifications read", e));
  };

  const badge = unread + localAlerts.length;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-gray-500 hover:text-gray-900 transition-colors"
        aria-label={t("notifications")}
        aria-expanded={open}
      >
        <Bell size={20} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full border border-white flex items-center justify-center">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden animate-fade-in-up">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">{t("notifications")}</h3>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                {t("mark_all_read")}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {localAlerts.map((alert) => (
              <div key={alert.id} className="p-3 border-b border-gray-50 bg-red-50/60 text-sm">
                <p className="font-bold text-red-700 mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {alert.title}
                </p>
                <p className="text-gray-700 text-xs leading-relaxed">{alert.message}</p>
              </div>
            ))}

            {loading && items.length === 0 && (
              <div className="p-6 flex items-center justify-center text-gray-400">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}

            {!loading && items.length === 0 && localAlerts.length === 0 && (
              <div className="p-4 text-center text-sm text-gray-500">{t("no_notifications")}</div>
            )}

            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={cn(
                  "w-full text-left p-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors",
                  !n.read && "bg-[var(--color-mint)]/40"
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      n.type === "DEMAND_ALERT"
                        ? "bg-green-100 text-green-700"
                        : n.type === "FESTIVAL"
                          ? "bg-orange-50 text-orange-600"
                          : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {iconFor(n.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className={cn("text-sm truncate", n.read ? "font-medium text-gray-700" : "font-bold text-gray-900")}>
                        {n.title}
                      </p>
                      <span className="ml-auto text-[10px] text-gray-400 shrink-0">
                        {relativeTime(n.createdAt, t)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed mt-0.5">{n.message}</p>
                    {n.channel && (
                      <span className="inline-block mt-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                        {n.channel === "IN_APP" ? t("in_app_alert") : n.channel}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
