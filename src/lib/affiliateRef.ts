"use client";

/**
 * Carrying a creator's `?ref=` handle from the link the shopper clicked
 * through to the checkout call.
 *
 * The storefront reads the URL directly rather than through `useSearchParams`,
 * because that hook forces a Suspense boundary on these fully-client pages —
 * the same reason `payment=success` is read this way. From there the handle
 * lives in `sessionStorage`, so it survives marketplace -> product -> buy but
 * dies with the tab. A creator gets credit for the visit they actually sent,
 * not for every purchase that shopper ever makes.
 */

import { slugifyHandle } from '@/lib/creators';

const KEY = 'karigari_ref';

/** Session-scoped, and never fatal: storage is blocked in some private modes. */
function readStored(): string {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

function store(handle: string) {
  try {
    sessionStorage.setItem(KEY, handle);
  } catch {
    // Nothing to do — attribution degrades to this page view only.
  }
}

/**
 * Pull `?ref=` off the current URL, remember it, and return it.
 *
 * A fresh `?ref=` always wins over a stored one: the shopper just followed a
 * different creator's link, and that is the one who sent them.
 */
export function captureRefFromUrl(): string {
  if (typeof window === 'undefined') return '';
  let handle = '';
  try {
    handle = slugifyHandle(new URLSearchParams(window.location.search).get('ref') || '');
  } catch {
    handle = '';
  }
  if (handle) {
    store(handle);
    return handle;
  }
  return readStored();
}

/** The handle in play for this session, without touching the URL. */
export function currentRef(): string {
  if (typeof window === 'undefined') return '';
  return readStored();
}

/**
 * Tell the server a creator's link was followed.
 *
 * Fire-and-forget: a failed analytics write must never stop a shopper from
 * seeing the shop.
 */
export function trackRef(handle: string, craftItemId?: string): void {
  if (!handle) return;
  void fetch('/api/creators/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, craftItemId: craftItemId || null }),
    keepalive: true,
  }).catch(() => {});
}
