/**
 * Who the buyer is, on a storefront with no buyer accounts.
 *
 * Buyers cannot sign in to this app: the marketplace and the demand board are
 * both public. What ties a purchase on `/marketplace` to the "My Orders" tab on
 * `/buyer` is therefore a free-text name, remembered in this browser only —
 * exactly the identity `Demand.buyerName` already uses.
 *
 * It is a convenience, not an authentication: anyone typing the same name sees
 * the same orders. Nothing here should ever gate money or personal data.
 */

export const BUYER_NAME_KEY = 'karigari_buyer_name';
export const BUYER_CONTACT_KEY = 'karigari_buyer_contact';

/** Placeholder identity for a first-time visitor, matching the demand board. */
export const DEFAULT_BUYER = 'Rajesh Retailers';

/** Reads a remembered value. Safe on the server and in a private window. */
function read(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(key) || '').trim();
  } catch {
    // Storage can throw outright when the browser blocks site data.
    return '';
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = value.trim();
    if (trimmed) window.localStorage.setItem(key, trimmed);
    else window.localStorage.removeItem(key);
  } catch {
    // Nothing to do: the name is a convenience, and losing it costs a retype.
  }
}

export function readBuyerName(): string {
  return read(BUYER_NAME_KEY);
}

export function readBuyerContact(): string {
  return read(BUYER_CONTACT_KEY);
}

/** Remembered after a successful purchase, so My Orders finds it. */
export function rememberBuyer(name: string, contact?: string): void {
  write(BUYER_NAME_KEY, name);
  if (contact !== undefined) write(BUYER_CONTACT_KEY, contact);
}
