"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ShieldCheck, Landmark, LogOut, Menu, X, Calendar, RefreshCw, Loader2 } from "lucide-react";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
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
 * Shared chrome for both admin dashboards.
 *
 * There is exactly one ADMIN role. The sidebar is how that single admin switches
 * between the Field Facilitator view and the Central Nodal Officer view.
 */
export function AdminShell({ title, subtitle, flagBadge, actions, children }: AdminShellProps) {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  React.useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (!data.success || data.role !== 'ADMIN') {
          router.replace('/login');
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  // `auth-token` is httpOnly, so it can only be cleared by the server.
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* Log out locally even if the request fails. */
    }
    router.replace("/login");
    router.refresh();
  };

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] flex">
      {/* On mobile the sidebar is an overlay drawer, so it needs a way out:
          the header's toggle sits underneath it at narrow widths. */}
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "bg-[var(--color-sidebar)] text-gray-800 transition-all duration-300 z-50 flex flex-col fixed inset-y-0 left-0 md:relative overflow-hidden shrink-0",
          isSidebarOpen ? "w-64" : "w-0 md:w-20"
        )}
      >
        <div className="h-16 flex items-center gap-2 px-4 border-b border-gray-200 shrink-0">
          <KarigariLogo variant="dark" showWordmark={isSidebarOpen} size={32} />
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-gray-400 hover:text-gray-700 transition-colors md:hidden"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-grow overflow-y-auto py-6">
          <nav className="space-y-1 px-3">
            <p
              className={cn(
                "px-4 pb-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider",
                isSidebarOpen ? "block" : "hidden"
              )}
            >
              Oversight
            </p>
            <NavItem
              icon={<ShieldCheck size={20} />}
              label="Facilitator"
              href="/admin/facilitator"
              active={pathname?.startsWith("/admin/facilitator")}
              isOpen={isSidebarOpen}
              badge={flagBadge && flagBadge > 0 ? String(flagBadge) : undefined}
            />
            <NavItem
              icon={<Landmark size={20} />}
              label="Nodal Oversight"
              href="/admin/nodal"
              active={pathname?.startsWith("/admin/nodal")}
              isOpen={isSidebarOpen}
            />
          </nav>

          <div className={cn("px-6 mt-8", isSidebarOpen ? "block" : "hidden")}>
            <p className="text-[11px] leading-relaxed text-gray-500">
              One console. Field-level artisan protection on the left, ministry-level policy
              evidence on the right.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-gray-500 hover:bg-red-50 hover:text-red-600",
              !isSidebarOpen && "justify-center"
            )}
            title={!isSidebarOpen ? "Logout" : undefined}
          >
            <LogOut size={20} className="shrink-0" />
            <span className={cn("whitespace-nowrap", isSidebarOpen ? "opacity-100" : "hidden")}>
              Logout
            </span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-grow flex flex-col min-w-0 bg-white md:bg-[var(--color-background)] md:m-2 md:rounded-2xl border border-gray-100 z-10 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-4 px-4 sm:px-6 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              className="text-gray-500 hover:text-gray-900 transition-colors shrink-0"
              aria-label="Toggle navigation"
            >
              <Menu size={24} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-serif font-bold text-gray-900 truncate">{title}</h1>
              {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <div className="hidden lg:flex items-center gap-2 text-sm font-medium text-gray-500">
              <Calendar size={16} />
              {new Date().toLocaleDateString("en-IN", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            {actions}
          </div>
        </header>

        <div className="flex-grow p-4 sm:p-6 lg:p-8 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  href,
  active,
  isOpen,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
  isOpen: boolean;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 px-3 py-3 rounded-xl transition-all group",
        active ? "bg-primary text-white font-medium" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        !isOpen && "justify-center"
      )}
      title={!isOpen ? label : undefined}
    >
      <div
        className={cn(
          "shrink-0 transition-colors",
          active ? "text-white" : "text-gray-400 group-hover:text-gray-800"
        )}
      >
        {icon}
      </div>
      <span className={cn("whitespace-nowrap", isOpen ? "opacity-100" : "hidden")}>{label}</span>
      {badge && isOpen && (
        <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      {badge && !isOpen && (
        <span className="absolute right-2 top-2 w-2 h-2 rounded-full bg-red-500"></span>
      )}
    </Link>
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
    <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-full sm:w-auto sm:inline-flex">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap",
            active === tab.key
              ? "bg-white text-primary shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          {tab.icon}
          {tab.label}
          {typeof tab.badge === "number" && tab.badge > 0 && (
            <span
              className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                active === tab.key ? "bg-primary/10 text-primary" : "bg-gray-200 text-gray-600"
              )}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Live-polling indicator shared by both dashboards. */
export function LiveBadge({ isRefreshing }: { isRefreshing: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full">
      <RefreshCw size={12} className={cn(isRefreshing && "animate-spin")} />
      {isRefreshing ? "Syncing" : "Live"}
    </div>
  );
}
