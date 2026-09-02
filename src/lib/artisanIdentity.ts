"use client";

/**
 * The signed-in artisan's name, photo and cluster, fetched once per session.
 *
 * The app shell draws an avatar in the header of every artisan page. Without a
 * shared store each navigation would re-request it, and pages that already
 * hold richer data (the dashboard) would disagree with the header about who is
 * signed in. One module-level cache, one request, one source of truth.
 */

import { useSyncExternalStore } from "react";

export interface ArtisanIdentity {
  name: string;
  photoUrl: string | null;
  craftType: string;
  clusterName: string;
  location: string;
  loaded: boolean;
}

const EMPTY: ArtisanIdentity = {
  name: "",
  photoUrl: null,
  craftType: "",
  clusterName: "",
  location: "",
  loaded: false,
};

let state: ArtisanIdentity = EMPTY;
const listeners = new Set<() => void>();

/** In flight, so ten mounted components make one request between them. */
let pending: Promise<ArtisanIdentity> | null = null;

function publish(next: ArtisanIdentity) {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Overwrite the cache from a page that already has better data.
 *
 * The dashboard loads the full profile anyway; letting it push the result here
 * means the header updates the moment a photo changes in the profile editor,
 * instead of staying stale until the next full page load.
 */
export function setArtisanIdentity(patch: Partial<ArtisanIdentity>) {
  publish({ ...state, ...patch, loaded: true });
}

export async function loadArtisanIdentity(): Promise<ArtisanIdentity> {
  if (state.loaded) return state;
  if (pending) return pending;

  pending = (async () => {
    try {
      const res = await fetch("/api/artisan/profile-lite", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data?.success) {
        publish({
          name: data.name || "",
          photoUrl: data.photoUrl || null,
          craftType: data.craftType || "",
          clusterName: data.clusterName || "",
          location: data.location || "",
          loaded: true,
        });
      } else {
        // Signed out, or the profile row does not exist yet. The avatar falls
        // back to a neutral initial rather than blocking the shell.
        publish({ ...EMPTY, loaded: true });
      }
    } catch (error) {
      console.warn("[artisanIdentity] load failed:", (error as Error)?.message);
      publish({ ...EMPTY, loaded: true });
    } finally {
      pending = null;
    }
    return state;
  })();

  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Same object every time — a fresh literal would loop useSyncExternalStore. */
const SERVER_SNAPSHOT: ArtisanIdentity = EMPTY;

export function useArtisanIdentity(): ArtisanIdentity {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_SNAPSHOT);
}
