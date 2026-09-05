"use client";

import { useEffect, useState } from "react";

/**
 * How good is this connection, right now?
 *
 * `navigator.connection` is Chromium-only, which is the majority of the Android
 * handsets this app targets. Everywhere else the honest answer is "assume it is
 * fine" — degrading a fast iPhone into low-res mode because Safari does not
 * expose the API would be worse than the problem.
 *
 * Callers use this to make three decisions, all of which are about NOT spending
 * the user's data:
 *   - skip the 24 MB background-removal model download entirely
 *   - poll less often
 *   - ask for a narrow thumbnail variant instead of the full capture
 */

export type EffectiveType = "slow-2g" | "2g" | "3g" | "4g";

interface NetworkInformationLike {
  effectiveType?: EffectiveType;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

function readConnection(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { connection?: NetworkInformationLike };
  return nav.connection ?? null;
}

export interface NetworkQuality {
  effectiveType: EffectiveType;
  /** The user asked their OS to save data. Honour it exactly like 2G. */
  saveData: boolean;
  /** 2G-class, or Data Saver on. The single flag most callers want. */
  isSlow: boolean;
  /** Poll interval callers should use, in ms. */
  pollMs: number;
  /** Width to request from `/api/items/:id/thumbnail?w=`, or null for full size. */
  thumbnailWidth: number | null;
  /** Whether it is reasonable to offer the 24 MB background-removal download. */
  allowHeavyDownloads: boolean;
}

/** Normal cadence for the live admin consoles. Mirrors ADMIN_POLL_MS. */
const POLL_NORMAL_MS = 15_000;
/** Backed off cadence on a 2G link — three taps' worth of data instead of nine. */
const POLL_SLOW_MS = 45_000;
/** Narrow variant width for list thumbnails on a slow link. */
const SLOW_THUMBNAIL_WIDTH = 200;

function derive(effectiveType: EffectiveType, saveData: boolean): NetworkQuality {
  const isSlow = saveData || effectiveType === "slow-2g" || effectiveType === "2g";
  return {
    effectiveType,
    saveData,
    isSlow,
    pollMs: isSlow ? POLL_SLOW_MS : POLL_NORMAL_MS,
    thumbnailWidth: isSlow ? SLOW_THUMBNAIL_WIDTH : null,
    allowHeavyDownloads: !isSlow,
  };
}

/**
 * Starts optimistic ("4g") and corrects after mount.
 *
 * Deliberately not read during render: `navigator` does not exist on the server
 * and a first client render that disagreed with the server markup is a
 * hydration mismatch.
 */
export function useNetworkQuality(): NetworkQuality {
  const [quality, setQuality] = useState<NetworkQuality>(() => derive("4g", false));

  useEffect(() => {
    const connection = readConnection();
    if (!connection) return;

    const sync = () =>
      setQuality(derive(connection.effectiveType ?? "4g", Boolean(connection.saveData)));

    // Deferred by a macrotask so the effect body performs no synchronous
    // setState — the same kickoff pattern the rest of the client uses.
    const kickoff = setTimeout(sync, 0);
    connection.addEventListener?.("change", sync);
    return () => {
      clearTimeout(kickoff);
      connection.removeEventListener?.("change", sync);
    };
  }, []);

  return quality;
}

/** Build a thumbnail URL, narrowed when the link is slow. */
export function thumbnailUrl(itemId: string, width: number | null): string {
  return width ? `/api/items/${itemId}/thumbnail?w=${width}` : `/api/items/${itemId}/thumbnail`;
}
