"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * Broadcast when any `useUrlTab` writes a new tab to the URL.
 *
 * `history.replaceState` fires no event of its own, so without this the app
 * shell — which highlights the matching rail entry from `?tab=` — never learned
 * that the tab had changed and kept the previous item lit. Same pattern as the
 * `language-change` event the i18n store already uses.
 */
const TAB_EVENT = "karigari:tab-change";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The URL read has to happen before the browser paints — that is what removes
 * the click race — but `useLayoutEffect` has no meaning during SSR and React
 * warns about it, so the server gets the no-op variant.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Read `?tab=` from the current URL, validated against the allowed set. */
function readTab<T extends string>(allowed: readonly T[]): T | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("tab");
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * A tab whose current value lives in the URL as `?tab=`.
 *
 * The admin rail deep links straight into a console's tab ("Voice QA",
 * "Global Audit"), so the tab has to be readable from — and writable back to —
 * the address bar, or clicking a nav item would land on the page's default tab
 * and the rail would highlight the wrong entry.
 *
 * The URL is read in a **layout** effect, not a deferred `setTimeout(…, 0)`.
 * The deferred read was a real bug: a click that landed before the queued
 * macrotask ran would set the tab and rewrite the URL, and then the pending
 * read would fire and stomp the value back — a visible flicker, and a first
 * click that appeared to do nothing. A layout effect runs before paint, so no
 * user input can get in front of it, and unlike a `useState` initializer it
 * cannot desync the server-rendered markup from the first client render.
 *
 * Still not `useSearchParams`: these are fully client pages and it would force
 * a Suspense boundary around each of them. `replaceState` rather than a router
 * push, so switching tabs does not stack a history entry per click.
 */
export function useUrlTab<T extends string>(
  fallback: T,
  allowed: readonly T[]
): [T, (next: T) => void] {
  const [tab, setTab] = useState<T>(fallback);

  useIsomorphicLayoutEffect(() => {
    // Synchronous on purpose — see the note above. Deferring it is the bug.
    // `allowed` is a literal tuple at every call site, so this reads once on
    // mount and never depends on its identity.
    const initial = readTab(allowed);
    if (initial) setTab(initial);
  }, []);

  useEffect(() => {
    // Back/forward only. `popstate` does not fire for `replaceState`, so this
    // never races with a click the user just made.
    const onPop = () => setTab(readTab(allowed) ?? fallback);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  const select = useCallback(
    (next: T) => {
      // Never accept a value outside the allowed set, whatever the caller did.
      if (!(allowed as readonly string[]).includes(next)) return;
      setTab(next);
      const params = new URLSearchParams(window.location.search);
      params.set("tab", next);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: next }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return [tab, select];
}

/**
 * The `?tab=` the current URL is on, for chrome that only needs to observe it —
 * the shell's rail highlight. Returns null when there is no tab in the URL, so
 * the caller can fall back to a page's own default.
 */
export function useObservedTab(): string | null {
  const [tab, setTab] = useState<string | null>(null);

  useIsomorphicLayoutEffect(() => {
    const read = () => setTab(new URLSearchParams(window.location.search).get("tab"));
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(TAB_EVENT, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(TAB_EVENT, read);
    };
  }, []);

  return tab;
}

/** One-shot read of a query parameter, for a deep-linked search term. */
export function useUrlParam(name: string): string {
  const [value, setValue] = useState("");

  useIsomorphicLayoutEffect(() => {
    // Read before paint for the same reason as the tab: a deferred read arrives
    // after the consumer has already run its first fetch with an empty term.
    const read = () =>
      setValue(new URLSearchParams(window.location.search).get(name) ?? "");
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [name]);

  return value;
}
