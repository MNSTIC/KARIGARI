"use client";

import { useCallback, useEffect, useState } from "react";
import en from "@/lib/i18n/en";

export type Language = "en" | "hi" | "or" | "te";

/**
 * Only English is bundled.
 *
 * The four dictionaries used to live in this one `"use client"` module, so
 * every page downloaded ~223 KB of strings — three quarters of which the
 * visitor could not read — before it could paint. English stays static because
 * it is the synchronous fallback `t` needs on the very first render; the other
 * three are fetched with a dynamic `import()` the moment they are chosen, and
 * cached for the rest of the session.
 */
const LOADERS: Record<Exclude<Language, "en">, () => Promise<{ default: Record<string, string> }>> = {
  hi: () => import("@/lib/i18n/hi"),
  or: () => import("@/lib/i18n/or"),
  te: () => import("@/lib/i18n/te"),
};

/** Language -> strings, filled in as dictionaries arrive. */
const loaded: Partial<Record<Language, Record<string, string>>> = { en };

/**
 * Kept for compatibility with anything that reached for the old export.
 * It is populated lazily, so read through `useLanguage().t` instead — a direct
 * read of a non-English entry may be empty until that dictionary has loaded.
 */
export const dictionary = loaded;

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "hi" || value === "or" || value === "te";
}

async function ensureLoaded(lang: Language): Promise<Record<string, string>> {
  const cached = loaded[lang];
  if (cached) return cached;
  if (lang === "en") return en;

  try {
    const mod = await LOADERS[lang]();
    loaded[lang] = mod.default;
    return mod.default;
  } catch (error) {
    // A failed chunk fetch must not blank the UI: English still renders.
    console.warn("[i18n] could not load", lang, (error as Error)?.message);
    return en;
  }
}

const STORAGE_KEY = "karigari_lang";

/** localStorage throws in private mode and during SSR; a read must never crash a page. */
function readStoredLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function useLanguage() {
  const [language, setLanguage] = useState<Language>("en");
  /** The strings actually in memory. Starts English, swaps in on load. */
  const [strings, setStrings] = useState<Record<string, string>>(en);

  // Fetch whichever dictionary the current language needs. Until it resolves
  // `t` falls through to English rather than rendering raw keys.
  useEffect(() => {
    let cancelled = false;
    ensureLoaded(language).then((dict) => {
      if (!cancelled) setStrings(dict);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    const saved = readStoredLanguage();
    if (saved) setLanguage(saved);

    // Same document: every mounted useLanguage() hears this the moment any of
    // them calls changeLanguage, so a switch in the header updates the page.
    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (isLanguage(detail)) setLanguage(detail);
    };

    // Other browser tabs: `storage` only fires cross-document, so this is what
    // keeps a second tab in sync. The CustomEvent above never reaches it.
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (isLanguage(e.newValue)) setLanguage(e.newValue);
    };

    window.addEventListener("language-change", handleCustom);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("language-change", handleCustom);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  /**
   * Both of these are memoized on purpose.
   *
   * A fresh function identity on every render propagates: a page that lists `t`
   * in a `useCallback` dependency array gets a new callback each render, the
   * effect watching that callback re-fires, its `setLoading(true)` triggers
   * another render, and the page spins forever while hammering its API.
   */
  const changeLanguage = useCallback((lang: Language) => {
    if (!isLanguage(lang)) return;
    // Warm the chunk before the re-render so the swap is not visibly stale.
    void ensureLoaded(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage blocked — the choice still applies for this session.
    }
    setLanguage(lang);
    window.dispatchEvent(new CustomEvent("language-change", { detail: lang }));
  }, []);

  const t = useCallback(
    (key: string): string => strings[key] || en[key] || key,
    [strings]
  );

  return { language, changeLanguage, t };
}
