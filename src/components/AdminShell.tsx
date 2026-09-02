"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { AppShell, Shell } from "@/components/ui/AppShell";
import { PageLede, PageTitle } from "@/components/ui/SectionEyebrow";
import { cn } from "@/lib/utils";

interface AdminShellProps {
  title: string;
  subtitle?: string;
  /** Live count rendered as a badge on the Facilitator nav item. */
  flagBadge?: number;
  /** Rendered at the right edge of the header (export buttons, refresh state...). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Chrome for both admin dashboards.
 *
 * There is exactly one ADMIN role; the shared rail is how that single admin
 * switches between the Field Facilitator view and the Central Nodal Officer
 * view. Both consoles now sit inside the same `AppShell` as the artisan app, so
 * the whole product is one design system — the only difference is which nav
 * groups the role unlocks.
 */
export function AdminShell({ title, subtitle, flagBadge, actions, children }: AdminShellProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.success || data.role !== "ADMIN") {
          router.replace("/login");
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={32} />
      </div>
    );
  }

  return (
    <AppShell role="ADMIN" actions={actions}>
      <Shell>
        <div className="mb-9 flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <PageTitle>{title}</PageTitle>
            {subtitle && <PageLede>{subtitle}</PageLede>}
          </div>

          {typeof flagBadge === "number" && flagBadge > 0 && (
            <span className="kg-label mt-3 shrink-0 rounded-full bg-[var(--color-maroon)] px-3.5 py-2 font-medium text-white">
              {flagBadge} flagged
            </span>
          )}
        </div>

        {children}

        {/* Logout is in the shared top bar for both roles — one control, on
            every screen, rather than a second copy buried down here. */}
      </Shell>
    </AppShell>
  );
}

/** Small shared control used by both dashboards to switch tabs. */
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; icon?: React.ReactNode; badge?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="kg-rail -mx-4 mb-8 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              "kg-press flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-5 text-[13px] font-semibold",
              isActive
                ? "bg-primary text-white"
                : "bg-[var(--color-pill)] text-gray-600 hover:bg-[#E3DCD2] hover:text-gray-900"
            )}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                  isActive ? "bg-white/20" : "bg-white/70 text-gray-600"
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Live-polling indicator shared by both dashboards. */
export function LiveBadge({ isRefreshing }: { isRefreshing: boolean }) {
  return (
    <span className="kg-label inline-flex items-center gap-2 rounded-full bg-[var(--color-pill)] px-3 py-2 font-medium text-gray-600">
      <RefreshCw size={12} className={cn(isRefreshing && "animate-spin")} />
      {isRefreshing ? "Syncing" : "Live"}
    </span>
  );
}
