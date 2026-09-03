"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Banknote,
  Bell,
  Boxes,
  ClipboardList,
  Eye,
  LayoutGrid,
  Megaphone,
  Mic,
  Newspaper,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useArtisanIdentity } from "@/lib/artisanIdentity";
import { useLanguage } from "@/lib/translations";
import { cn } from "@/lib/utils";

/**
 * The left rail, and the same rail as a drawer on a phone.
 *
 * Nav is grouped under tracked uppercase headers and **gated by role**: an
 * artisan only ever sees artisan destinations, and the Facilitator / Nodal
 * Officer groups are rendered for an ADMIN session only. That is a real
 * boundary, not a cosmetic one — every `/admin/*` page re-checks the role
 * server-side — but an artisan should never be shown a door they cannot open.
 */

export type ShellRole = "ARTISAN" | "ADMIN";

interface NavEntry {
  href: string;
  /** i18n key; the rail translates it at render time. */
  label: string;
  icon: React.ReactNode;
  /** Extra route prefixes that should light this item up. */
  match?: string[];
  /** Matches only when the URL carries this `?tab=` value. */
  tab?: string;
}

interface NavGroup {
  /** i18n key. */
  heading: string;
  items: NavEntry[];
}

/**
 * Artisan navigation.
 *
 * The first group is the reference's ARTISAN VIEW, item for item. The second
 * holds the destinations the app has that the mockup did not draw — earnings,
 * influencer marketing, notifications — because dropping them from the nav
 * would make working features unreachable.
 */
const ARTISAN_GROUPS: NavGroup[] = [
  {
    heading: "shell_group_artisan_view",
    items: [
      { href: "/artisan/dashboard", label: "nav_dashboard", icon: <LayoutGrid size={19} strokeWidth={1.6} /> },
      { href: "/artisan/market", label: "nav_marketplace", icon: <Store size={19} strokeWidth={1.6} /> },
      { href: "/artisan/materials", label: "nav_raw_materials", icon: <Boxes size={19} strokeWidth={1.6} /> },
      { href: "/artisan/insights", label: "nav_market_insights", icon: <TrendingUp size={19} strokeWidth={1.6} /> },
      { href: "/artisan/schemes", label: "nav_schemes", icon: <ScanFace size={19} strokeWidth={1.6} /> },
      { href: "/artisan/learn", label: "nav_ai_learning", icon: <Sparkles size={19} strokeWidth={1.6} /> },
      {
        href: "/artisan/news",
        label: "nav_news_updates",
        // The news icon stays red — carried over from the earlier design pass.
        icon: <Newspaper size={19} strokeWidth={1.6} className="text-[var(--color-maroon)]" />,
      },
    ],
  },
  {
    heading: "shell_group_my_workshop",
    items: [
      { href: "/artisan/orders", label: "nav_orders", icon: <ClipboardList size={19} strokeWidth={1.6} /> },
      { href: "/artisan/cluster", label: "nav_cluster", icon: <Users size={19} strokeWidth={1.6} /> },
      { href: "/artisan/earnings", label: "nav_earnings", icon: <Banknote size={19} strokeWidth={1.6} /> },
      { href: "/artisan/marketing", label: "nav_influencer_marketing", icon: <Megaphone size={19} strokeWidth={1.6} /> },
      { href: "/artisan/notifications", label: "nav_notifications", icon: <Bell size={19} strokeWidth={1.6} /> },
    ],
  },
];

/**
 * Admin navigation. Both dashboards are tabbed pages, so each nav item deep
 * links straight into the tab it names rather than dropping the admin on a
 * landing tab they then have to switch away from.
 */
const ADMIN_GROUPS: NavGroup[] = [
  {
    heading: "shell_group_facilitator",
    items: [
      {
        href: "/admin/facilitator?tab=cluster",
        label: "nav_field_oversight",
        icon: <Eye size={19} strokeWidth={1.6} />,
        match: ["/admin/facilitator"],
        tab: "cluster",
      },
      {
        href: "/admin/facilitator?tab=qa",
        label: "nav_voice_qa",
        icon: <Mic size={19} strokeWidth={1.6} />,
        match: ["/admin/facilitator"],
        tab: "qa",
      },
    ],
  },
  {
    heading: "shell_group_nodal",
    items: [
      {
        href: "/admin/nodal?tab=impact",
        label: "nav_analytics",
        icon: <Activity size={19} strokeWidth={1.6} />,
        match: ["/admin/nodal"],
        tab: "impact",
      },
      {
        href: "/admin/nodal?tab=audit",
        label: "nav_global_audit",
        icon: <ShieldCheck size={19} strokeWidth={1.6} />,
        match: ["/admin/nodal"],
        tab: "audit",
      },
    ],
  },
];

export function groupsForRole(role: ShellRole): NavGroup[] {
  return role === "ADMIN" ? ADMIN_GROUPS : ARTISAN_GROUPS;
}

/** The home destination for each role, used by the wordmark link. */
export function homeForRole(role: ShellRole): string {
  return role === "ADMIN" ? "/admin/facilitator" : "/artisan/dashboard";
}

function isActive(pathname: string, activeTab: string | null, item: NavEntry): boolean {
  const prefixes = item.match ?? [item.href];
  const pathMatches = prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!pathMatches) return false;
  if (!item.tab) return true;
  // Two nav entries share one route; the query string is what tells them apart.
  // With no tab in the URL the page shows its own default, which is the first
  // entry of the pair.
  const siblings = ADMIN_GROUPS.flatMap((g) => g.items).filter((i) =>
    (i.match ?? [i.href]).some((p) => pathname.startsWith(p))
  );
  if (activeTab) return item.tab === activeTab;
  return siblings[0]?.tab === item.tab;
}

/** Wordmark + eyebrow, shared by the rail and the drawer. */
function Wordmark({ role }: { role: ShellRole }) {
  const { t } = useLanguage();

  return (
    <Link href={homeForRole(role)} className="block shrink-0">
      <span className="kg-display block text-[26px] leading-none text-gray-900">Karigari</span>
      <span className="kg-label mt-1.5 block font-medium text-gray-400">
        {t("shell_eyebrow")}
      </span>
    </Link>
  );
}

function NavList({
  groups,
  pathname,
  activeTab,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  activeTab: string | null;
  onNavigate?: () => void;
}) {
  const { t } = useLanguage();

  return (
    <nav aria-label="Main" className="flex flex-col gap-7">
      {groups.map((group) => (
        <div key={group.heading}>
          <p className="kg-label mb-2.5 px-3 font-medium text-gray-400">{t(group.heading)}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, activeTab, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "kg-press flex min-h-[46px] items-center gap-3.5 rounded-xl px-3 text-[15px] transition-colors",
                      active
                        ? "bg-primary font-semibold text-white"
                        : "font-medium text-gray-700 hover:bg-white/70 hover:text-gray-900"
                    )}
                  >
                    <span className={cn("shrink-0", active && "text-white [&_svg]:text-white")}>
                      {item.icon}
                    </span>
                    <span className="truncate">{t(item.label)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The signed-in artisan's chip at the foot of the rail — real name, real role,
 * and a settings control that opens the same profile editor the header avatar
 * does.
 */
function UserChip({ role, onSettings }: { role: ShellRole; onSettings?: () => void }) {
  const identity = useArtisanIdentity();

  if (role === "ADMIN") {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <ShieldCheck size={16} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-gray-900">Admin</span>
          <span className="kg-label block text-gray-500">Nodal &amp; Facilitator</span>
        </span>
      </div>
    );
  }

  if (!identity.loaded || !identity.name) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5">
      <Avatar name={identity.name} src={identity.photoUrl} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-gray-900">
          {identity.name}
        </span>
        <span className="kg-label block truncate text-gray-500">
          {identity.craftType || "Artisan"}
        </span>
      </span>
      {onSettings && (
        <button
          type="button"
          onClick={onSettings}
          aria-label="Profile settings"
          className="kg-press shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Desktop rail. Fixed, so the content column is inset rather than laid beside it. */
export function Sidebar({
  role,
  onSettings,
  activeTab,
}: {
  role: ShellRole;
  onSettings?: () => void;
  activeTab: string | null;
}) {
  const pathname = usePathname() || "";

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-gray-200/70 bg-[var(--color-sidebar)] px-4 py-7 lg:flex">
      <div className="px-3">
        <Wordmark role={role} />
      </div>

      <div className="mt-9 flex-1 overflow-y-auto pb-4">
        <NavList groups={groupsForRole(role)} pathname={pathname} activeTab={activeTab} />
      </div>

      <div className="mt-auto shrink-0 pt-3">
        <UserChip role={role} onSettings={onSettings} />
      </div>
    </aside>
  );
}

/**
 * Mobile drawer. Same information architecture as the rail — one nav model for
 * the whole app rather than a second, shorter one on phones that hides half the
 * destinations.
 */
export function NavDrawer({
  role,
  open,
  onClose,
  onSettings,
  activeTab,
}: {
  role: ShellRole;
  open: boolean;
  onClose: () => void;
  onSettings?: () => void;
  activeTab: string | null;
}) {
  const pathname = usePathname() || "";

  // Escape closes it, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="kg-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="kg-slide-in absolute inset-y-0 left-0 flex w-[280px] max-w-[86vw] flex-col bg-[var(--color-sidebar)] px-4 py-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-3">
          <Wordmark role={role} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="kg-press -mr-1 -mt-1 rounded-full p-2 text-gray-500 hover:bg-white/70"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-8 flex-1 overflow-y-auto pb-4">
          <NavList
            groups={groupsForRole(role)}
            pathname={pathname}
            activeTab={activeTab}
            onNavigate={onClose}
          />
        </div>

        <div className="mt-auto shrink-0 pt-3">
          <UserChip
            role={role}
            onSettings={
              onSettings
                ? () => {
                    onClose();
                    onSettings();
                  }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
