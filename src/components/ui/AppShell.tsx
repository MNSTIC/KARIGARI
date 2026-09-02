"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NavDrawer, Sidebar, type ShellRole } from "@/components/ui/Sidebar";
import { TopBar } from "@/components/ui/TopBar";
import { loadArtisanIdentity } from "@/lib/artisanIdentity";
import { useObservedTab } from "@/lib/urlTab";
import { cn } from "@/lib/utils";

/**
 * The frame every signed-in page renders inside.
 *
 * Rail and header live here rather than in each page, so switching tabs swaps
 * only the page body — the nav does not remount, the notification bell does not
 * re-fetch, and the transition reads as instant. Above `lg` the rail is fixed
 * and the content column is inset past it; below `lg` the same nav is a drawer,
 * so there is one information architecture rather than a second, shorter one on
 * phones.
 */
export function AppShell({
  children,
  role = "ARTISAN",
  onProfileClick,
  actions,
}: {
  children: React.ReactNode;
  role?: ShellRole;
  onProfileClick?: () => void;
  /** Page-specific header controls. */
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /**
   * The `?tab=` an admin route is on, so the rail lights the right entry.
   *
   * Read through the shared hook rather than a local `setTimeout` scrape: the
   * tab is changed with `history.replaceState`, which fires no event, so a
   * local reader only ever saw the value from the last navigation and left the
   * previous rail item highlighted after a tab click.
   */
  const activeTab = useObservedTab();

  useEffect(() => {
    // One request per session, shared by the header avatar, the rail's user
    // chip and any page that asks for it. Deferred a macrotask so the effect
    // body performs no synchronous setState.
    const kickoff = setTimeout(() => {
      if (role === "ARTISAN") void loadArtisanIdentity();
    }, 0);
    return () => clearTimeout(kickoff);
  }, [role]);

  // A route change while the drawer is open has to close it, or the artisan
  // lands on the new page with the overlay still covering it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="min-h-screen bg-[var(--color-background)] font-sans">
      <Sidebar role={role} onSettings={onProfileClick} activeTab={activeTab} />
      <NavDrawer
        role={role}
        open={drawerOpen}
        onClose={closeDrawer}
        onSettings={onProfileClick}
        activeTab={activeTab}
      />

      {/* The rail is fixed, so the content column is inset rather than laid out
          beside it — that keeps the sticky header working without a nested
          scroll container. */}
      <div className="lg:pl-[264px]">
        <TopBar
          role={role}
          onMenu={() => setDrawerOpen(true)}
          onProfileClick={onProfileClick}
          actions={actions}
        />
        <main className="pb-20">{children}</main>
      </div>
    </div>
  );
}

/** The standard content column: one max width, one gutter, everywhere. */
export function Shell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10 lg:px-10", className)}>
      {children}
    </div>
  );
}
