"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Globe, LogOut, Menu, Package, Search, SignalLow } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { logout } from "@/lib/authClient";
import { NotificationsBell } from "@/components/NotificationsBell";
import { OfflineQueueBadge } from "@/components/OfflineQueueBadge";
import { groupsForRole, type ShellRole } from "@/components/ui/Sidebar";
import { useArtisanIdentity } from "@/lib/artisanIdentity";
import { useLanguage, type Language } from "@/lib/translations";
import { useNetworkQuality } from "@/lib/useNetworkQuality";
import { cn } from "@/lib/utils";

/**
 * The sticky header: search, language, notifications, avatar.
 *
 * It lives in the shell rather than in each page, so a tab switch swaps only
 * the page body — the bar does not remount and the notification bell does not
 * re-fetch on every navigation.
 */

const LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: "en", label: "English", short: "English" },
  { code: "hi", label: "हिंदी", short: "हिंदी" },
  { code: "or", label: "ଓଡ଼ିଆ", short: "ଓଡ଼ିଆ" },
  { code: "te", label: "తెలుగు", short: "తెలుగు" },
];

interface SearchHit {
  href: string;
  title: string;
  meta: string;
  kind: "page" | "craft";
  image?: string | null;
}

/**
 * The artisan's own craft items, fetched once per session for the search box.
 *
 * Module-level so opening the search on five different pages makes one request
 * between them — the same reasoning as the shared identity store.
 */
let craftCache: SearchHit[] | null = null;
let craftPending: Promise<SearchHit[]> | null = null;

async function loadCrafts(): Promise<SearchHit[]> {
  if (craftCache) return craftCache;
  if (craftPending) return craftPending;

  craftPending = (async () => {
    try {
      const res = await fetch("/api/artisan/listings", { cache: "no-store" });
      const data = await res.json();
      const rows = [...(data?.listings ?? []), ...(data?.drafts ?? [])];
      craftCache = rows.map(
        (row: { id: string; craftType?: string; patchId?: string | null; status?: string; images?: string[] }) => ({
          href: `/artisan/market?item=${row.id}`,
          title: row.craftType || "Craft item",
          meta: row.patchId || String(row.status || "").replace(/_/g, " ").toLowerCase(),
          kind: "craft" as const,
          image: row.images?.[0] ?? null,
        })
      );
    } catch (error) {
      console.warn("[search] could not load crafts:", (error as Error)?.message);
      craftCache = [];
    } finally {
      craftPending = null;
    }
    return craftCache ?? [];
  })();

  return craftPending;
}

function LanguageMenu() {
  const { language, changeLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="kg-press flex min-h-[40px] items-center gap-2 rounded-full px-2.5 text-gray-600 hover:bg-[var(--color-pill)] hover:text-gray-900"
      >
        <Globe size={17} strokeWidth={1.7} />
        <span className="kg-label hidden font-medium sm:inline">{current.short}</span>
        <ChevronDown size={14} className="hidden sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-36 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-soft">
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => {
                changeLanguage(option.code);
                setOpen(false);
              }}
              className={cn(
                "block w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50",
                language === option.code
                  ? "font-semibold text-gray-900"
                  : "font-medium text-gray-600"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sign out, in the header where every role can reach it.
 *
 * It used to sit at the very bottom of the artisan dashboard and the bottom of
 * the admin shell, which meant the control was only reachable from two of a
 * dozen screens and only after scrolling past everything else. In the bar it is
 * on every screen the shell renders, artisan and admin alike.
 */
function LogoutButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void logout(router);
      }}
      aria-label={t("logout")}
      title={t("logout")}
      className="kg-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-700 hover:bg-[var(--color-pill)] hover:text-[var(--color-maroon)] disabled:opacity-50"
    >
      <LogOut size={17} strokeWidth={1.7} />
    </button>
  );
}

/**
 * Real search, not a decorative input.
 *
 * An artisan searches their own crafts (by name or patch ID) and the app's own
 * destinations. An admin searches the immutable ledger: the term is handed to
 * Global Audit, which is the surface that can actually resolve a patch or
 * product ID.
 */
function SearchBox({ role, onNavigate }: { role: ShellRole; onNavigate?: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [crafts, setCrafts] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const pages: SearchHit[] = useMemo(
    () =>
      groupsForRole(role).flatMap((group) =>
        group.items.map((item) => ({
          href: item.href,
          // Nav entries carry i18n keys, so search matches what is on screen.
          title: t(item.label),
          meta: t(group.heading),
          kind: "page" as const,
        }))
      ),
    [role, t]
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const focus = useCallback(() => {
    setOpen(true);
    if (role === "ARTISAN" && crafts.length === 0) {
      void loadCrafts().then(setCrafts);
    }
  }, [role, crafts.length]);

  const term = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!term) return [];
    const match = (hit: SearchHit) =>
      hit.title.toLowerCase().includes(term) || hit.meta.toLowerCase().includes(term);
    return [...crafts.filter(match), ...pages.filter(match)].slice(0, 6);
  }, [term, crafts, pages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!term) return;
    if (role === "ADMIN") {
      router.push(`/admin/nodal?tab=audit&q=${encodeURIComponent(query.trim())}`);
    } else if (hits.length > 0) {
      router.push(hits[0].href);
    }
    setOpen(false);
    onNavigate?.();
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <form onSubmit={submit} role="search">
        <label className="sr-only" htmlFor="kg-search">
          Search
        </label>
        <div className="relative">
          <Search
            size={17}
            strokeWidth={1.7}
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            id="kg-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={focus}
            placeholder={t(
              role === "ADMIN" ? "search_placeholder_admin" : "search_placeholder_artisan"
            )}
            className="h-11 w-full rounded-full border border-transparent bg-[var(--color-pill)] pl-11 pr-4 text-[14px] text-gray-900 placeholder:text-gray-500 focus:border-gray-300 focus:bg-white focus:outline-none"
          />
        </div>
      </form>

      {open && term.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-soft">
          {hits.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-500">
              {role === "ADMIN"
                ? "Press Enter to trace this ID in the Global Audit ledger."
                : "Nothing here matches that yet."}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((hit) => (
                <li key={`${hit.kind}-${hit.href}-${hit.title}`}>
                  <Link
                    href={hit.href}
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      onNavigate?.();
                    }}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--color-pill)] text-gray-500">
                      {hit.kind === "craft" ? <Package size={15} /> : <Search size={14} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-gray-900">
                        {hit.title}
                      </span>
                      <span className="kg-label block truncate text-gray-400">{hit.meta}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  role,
  onMenu,
  onProfileClick,
  actions,
}: {
  role: ShellRole;
  onMenu: () => void;
  onProfileClick?: () => void;
  /** Page-specific controls, rendered before the bell. */
  actions?: React.ReactNode;
}) {
  const identity = useArtisanIdentity();

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/60 bg-[var(--color-background)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-[1180px] items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-10">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="kg-press -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-700 hover:bg-[var(--color-pill)] lg:hidden"
        >
          <Menu size={21} strokeWidth={1.7} />
        </button>

        {/* The wordmark only appears where the rail is hidden; above lg it
            already sits at the top of the sidebar. */}
        <Link href={role === "ADMIN" ? "/admin/facilitator" : "/artisan/dashboard"} className="lg:hidden">
          <span className="kg-display text-xl leading-none text-gray-900">Karigari</span>
        </Link>

        <div className="ml-auto hidden min-w-0 max-w-[420px] flex-1 sm:ml-0 sm:block lg:max-w-[520px]">
          <SearchBox role={role} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <SlowConnectionPill />
          <OfflineQueueBadge />
          {actions}
          <LanguageMenu />
          <LogoutButton />

          {/* The bell keeps its own dropdown and unread logic — only the
              trigger is restyled, and it is restyled through a prop so the
              rule cannot reach the buttons inside the dropdown. */}
          <NotificationsBell triggerClassName="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 hover:bg-[var(--color-pill)]" />

          <button
            type="button"
            onClick={onProfileClick}
            aria-label="Profile"
            className="kg-press ml-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-full"
          >
            {role === "ADMIN" ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-white">
                A
              </span>
            ) : (
              <Avatar name={identity.name} src={identity.photoUrl} size={40} />
            )}
          </button>
        </div>
      </div>

      {/* Below sm the search moves to its own row rather than being dropped:
          it is a real feature, and squeezing it beside four controls on a
          360px screen is what pushes the avatar off the edge. */}
      <div className="px-4 pb-3 sm:hidden">
        <SearchBox role={role} />
      </div>
    </header>
  );
}

/**
 * "Slow connection — reduced media".
 *
 * Only renders on a 2G-class link or with Data Saver on. It exists so the
 * artisan understands WHY their thumbnails got smaller and the dashboard
 * refreshes less often, rather than concluding the app is broken.
 */
function SlowConnectionPill() {
  const { t } = useLanguage();
  const network = useNetworkQuality();
  if (!network.isSlow) return null;
  return (
    <span
      title={t("slow_connection_pill")}
      className="kg-label hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1.5 font-medium text-amber-800 sm:inline-flex"
    >
      <SignalLow size={13} /> {t("slow_connection_pill")}
    </span>
  );
}
