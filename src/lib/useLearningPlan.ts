"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isLearningCacheStale,
  learningCacheIsMemoryOnly,
  patchLearningCache,
  readLearningCache,
  writeLearningCache,
} from "@/lib/learningCache";
import { buildTracks, type LearningItem, type LearningPayload, type LearningTracks, type LearningSource } from "@/lib/learningPlan";
import type { StageEarnings, StageInputs, StageResult } from "@/lib/skillStage";

/**
 * The learn page's data: saved copy first, network second, catalogue last.
 *
 *  1. A copy saved on this phone renders at once.
 *  2. GET /api/artisan/learning-recommendations revalidates it in the
 *     background and replaces it (and the saved copy) when it answers.
 *  3. When that fails the saved copy stays and `showingSaved` is set, so the
 *     page can say when it was generated. A copy older than
 *     LEARNING_CACHE_TTL_DAYS is retried the moment the phone reconnects.
 *  4. With no saved copy and no network, the catalogue is built right here —
 *     standard suggestions, no stage — so the page is never blank. Either kind
 *     of failure retries once the phone reports it is back online.
 */

export type LearningOrigin = "network" | "saved" | "fallback";

export interface LearningPlanState {
  /** Null only for the moment before the saved copy has been read. */
  tracks: LearningTracks | null;
  source: LearningSource;
  mixed: boolean;
  origin: LearningOrigin | null;
  /** Stage, counts and money streams — absent in the offline catalogue fallback. */
  stage: StageResult | null;
  inputs: StageInputs | null;
  earnings: StageEarnings | null;
  completed: string[];
  generatedAt: string | null;
  /** The craft the suggestions were made for; null when the artisan has not set one. */
  craftType: string | null;
  /** The language this state was produced for, so a switch is never ignored. */
  forLanguage: string | null;
  /** The last revalidation failed and a saved copy is being shown. */
  showingSaved: boolean;
  /** A mark-as-done that could not be saved, for the page's alert. */
  saveError: boolean;
  pendingKey: string | null;
}

const EMPTY: LearningPlanState = {
  tracks: null,
  source: "CURATED",
  mixed: false,
  origin: null,
  stage: null,
  inputs: null,
  earnings: null,
  completed: [],
  generatedAt: null,
  craftType: null,
  forLanguage: null,
  showingSaved: false,
  saveError: false,
  pendingKey: null,
};

function fromPayload(payload: LearningPayload, origin: LearningOrigin, forLanguage: string): Partial<LearningPlanState> {
  return {
    tracks: payload.tracks,
    source: payload.source,
    mixed: payload.mixed,
    origin,
    stage: payload.stage,
    inputs: payload.inputs,
    earnings: payload.earnings,
    completed: payload.completed,
    generatedAt: payload.generatedAt,
    craftType: payload.craftType,
    forLanguage,
  };
}

export function useLearningPlan(language: string, craftType: string) {
  const [state, setState] = useState<LearningPlanState>(EMPTY);
  const artisanIdRef = useRef<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let onOnline: (() => void) | null = null;

    const kickoff = setTimeout(async () => {
      const saved = await readLearningCache(language);
      if (cancelled) return;
      if (saved) {
        artisanIdRef.current = saved.payload.artisanId;
        // Only a fresh answer for THIS language outranks the saved copy: when
        // the artisan switches language offline, the copy saved in the new
        // language is what they asked for.
        setState((prev) =>
          prev.origin === "network" && prev.forLanguage === language ? prev : { ...prev, ...fromPayload(saved.payload, "saved", language) }
        );
      }

      try {
        const res = await fetch(`/api/artisan/learning-recommendations?lang=${encodeURIComponent(language)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json()) as LearningPayload | { success: false };
        if (!res.ok || !data?.success) throw new Error(`learning-recommendations ${res.status}`);
        if (cancelled) return;
        artisanIdRef.current = data.artisanId;
        setState((prev) => ({ ...prev, ...fromPayload(data, "network", language), showingSaved: false }));
        void writeLearningCache(data);
      } catch (error) {
        if (cancelled || (error as Error)?.name === "AbortError") return;
        if (saved) {
          setState((prev) => ({ ...prev, showingSaved: !learningCacheIsMemoryOnly() }));
          if (isLearningCacheStale(saved.savedAt)) {
            onOnline = () => setRetryToken((token) => token + 1);
            window.addEventListener("online", onOnline, { once: true });
          }
        } else {
          setState((prev) =>
            prev.origin === "network" && prev.forLanguage === language
              ? prev
              : { ...prev, tracks: null, source: "CURATED", mixed: false, origin: "fallback", generatedAt: null, forLanguage: language }
          );
          onOnline = () => setRetryToken((token) => token + 1);
          window.addEventListener("online", onOnline, { once: true });
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(kickoff);
      controller.abort();
      if (onOnline) window.removeEventListener("online", onOnline);
    };
  }, [language, retryToken]);

  /** Opening the search counts as starting the lesson. Best effort, never blocks the link. */
  const markStarted = useCallback((item: LearningItem) => {
    if (state.completed.includes(item.key)) return;
    void fetch("/api/artisan/learning-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKey: item.key, action: "start" }),
      keepalive: true,
    }).catch(() => {});
  }, [state.completed]);

  const toggleDone = useCallback(async (item: LearningItem) => {
    const wasDone = state.completed.includes(item.key);
    const optimistic = wasDone
      ? state.completed.filter((key) => key !== item.key)
      : [...state.completed, item.key];
    setState((prev) => ({ ...prev, completed: optimistic, pendingKey: item.key, saveError: false }));

    try {
      const res = await fetch("/api/artisan/learning-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleKey: item.key, action: wasDone ? "undo" : "complete" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(`learning-progress ${res.status}`);
      setState((prev) => ({
        ...prev,
        pendingKey: null,
        stage: data.stage,
        inputs: data.inputs,
        earnings: data.earnings,
      }));
      if (artisanIdRef.current) {
        void patchLearningCache(artisanIdRef.current, {
          completed: optimistic,
          stage: data.stage,
          inputs: data.inputs,
          earnings: data.earnings,
        });
      }
    } catch {
      setState((prev) => ({ ...prev, completed: state.completed, pendingKey: null, saveError: true }));
    }
  }, [state.completed]);

  const dismissError = useCallback(() => setState((prev) => ({ ...prev, saveError: false })), []);

  // The offline catalogue is built from the craft the header already knows, and
  // rebuilt if that arrives after the network gave up.
  const fallbackTracks = useMemo(
    () => (state.origin === "fallback" ? buildTracks([], { craftType, stage: null }).tracks : null),
    [state.origin, craftType]
  );

  return { ...state, tracks: fallbackTracks ?? state.tracks, markStarted, toggleDone, dismissError };
}
