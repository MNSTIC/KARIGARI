"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Handshake,
  Loader2,
  Package,
  ScanLine,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/translations";

/**
 * The buyer's alert bell.
 *
 * A sibling of `NotificationsBell` rather than a shared component with a prop
 * for which endpoint to call: the two read different tables with different
 * identity models (an artisan is a `User` behind a JWT, a buyer is a free-text
 * name on a public route), and the artisan panel carries a demand-detail
 * expander and an SMS-reply badge that mean nothing here. One component
 * covering both would be a component whose every row is conditional.
 *
 * The look is deliberately identical, because to a person these are the same
 * object.
 */

interface BuyerNotification {
  id: string;
  demandId: string;
  artisanOrderId: string | null;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

function iconFor(type: string) {
  if (type === "ORDER_ACCEPTED") return <Handshake size={14} />;
  if (type === "DAILY_UPDATE") return <Package size={14} />;
  if (type === "ORDER_READY") return <ScanLine size={14} />;
  if (type === "ORDER_PACKED") return <Package size={14} />;
  if (type === "ORDER_DISPATCHED") return <Truck size={14} />;
  if (type === "ORDER_DELIVERED") return <CheckCircle2 size={14} />;
  if (type === "PURCHASE_CONFIRMED") return <ShoppingBag size={14} />;
  return <Bell size={14} />;
}

/** Mint for a milestone, neutral for the rest. No new colours. */
function toneFor(type: string): string {
  if (type === "ORDER_DELIVERED" || type === "ORDER_READY" || type === "ORDER_ACCEPTED") {
    return "bg-[var(--color-mint)] text-primary";
  }
  return "bg-gray-100 text-gray-500";
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

export function BuyerNotificationsBell({
  buyerName,
  onOpenDemand,
  triggerClassName,
}: {
  buyerName: string;
  /**
   * Deep-link handler: the host page knows how to switch tabs and scroll to a
   * card, and this component should not have to.
   */
  onOpenDemand?: (demandId: string) => void;
  triggerClassName?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BuyerNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!buyerName.trim()) {
      setItems([]);
      setUnread(0);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/buyer/notifications?buyer=${encodeURIComponent(buyerName)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch (e) {
      console.error("Failed to load buyer notifications", e);
    } finally {
      setLoading(false);
    }
  }, [buyerName]);

  useEffect(() => {
    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of this app uses.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const markRead = async (id: string) => {
    // Optimistic: the badge should drop the instant the buyer reads the row,
    // and a failed write is not worth making them watch a spinner for.
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await fetch("/api/buyer/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerName, id }),
    }).catch((e) => console.error("Failed to mark buyer notification read", e));
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await fetch("/api/buyer/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerName, all: true }),
    }).catch((e) => console.error("Failed to mark buyer notifications read", e));
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative text-gray-500 transition-colors hover:text-gray-900",
          triggerClassName
        )}
        aria-label={t("notifications")}
        aria-expanded={open}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full border border-white flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
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
            {loading && items.length === 0 && (
              <div className="p-6 flex items-center justify-center text-gray-400">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="p-4 text-center text-sm text-gray-500">
                {t("buyer_no_notifications")}
              </div>
            )}

            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) void markRead(n.id);
                  if (onOpenDemand) {
                    onOpenDemand(n.demandId);
                    setOpen(false);
                  }
                }}
                className={cn(
                  "w-full text-left p-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors",
                  !n.read && "bg-[var(--color-mint)]/40"
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      toneFor(n.type)
                    )}
                  >
                    {iconFor(n.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      {/* min-w-0 is what makes `truncate` work inside a flex
                          row; without it the title refuses to shrink and pushes
                          the timestamp out of the panel. */}
                      <p
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          n.read ? "font-medium text-gray-700" : "font-bold text-gray-900"
                        )}
                      >
                        {n.title}
                      </p>
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {relativeTime(n.createdAt, t)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{n.message}</p>
                    <span className="mt-1.5 inline-block font-mono text-[10px] font-bold text-gray-400">
                      REQ-{n.demandId.slice(0, 6).toUpperCase()}
                    </span>
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
