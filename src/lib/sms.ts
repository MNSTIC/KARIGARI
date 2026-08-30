/**
 * Outbound SMS for demand alerts.
 *
 * Sending is best-effort by design: an artisan alert going out is valuable, but
 * a Twilio outage, an exhausted trial quota or an unverified number must never
 * be able to fail the buyer's demand post. Every path here resolves — nothing
 * throws — and a missing credential simply skips.
 */

import twilio from 'twilio';

export type SmsResult =
  | { sid: string }
  | { skipped: true; reason: string }
  | { error: string };

/**
 * Normalise an Indian mobile number to E.164.
 *
 * Profiles store these however they were typed — "98765 43210", "+91 98765
 * 43210", "09876543210". Anything we cannot confidently resolve returns null
 * and is skipped rather than guessed at, because a wrong number means texting a
 * stranger.
 */
export function toE164(raw?: string | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  // Already E.164: keep it, but only if what follows is plausible.
  if (value.startsWith('+')) {
    const digits = value.slice(1).replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  // A leading trunk '0' before the 10-digit number.
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return null;
}

/**
 * Optional recipient allowlist.
 *
 * The seeded artisan profiles carry real-looking Indian mobile numbers, so a
 * single demand post fans out to all of them. A Twilio trial refuses
 * unverified recipients, but that safety net disappears the moment the account
 * is upgraded — at which point a demo would text real strangers, which cannot
 * be taken back. Setting `SMS_ALLOWLIST` to a comma-separated list of numbers
 * restricts sending to exactly those; leaving it unset preserves the normal
 * behaviour of texting every matched artisan.
 */
function isAllowed(to: string): boolean {
  const raw = (process.env.SMS_ALLOWLIST || '').trim();
  if (!raw) return true;

  const last10 = (v: string) => v.replace(/\D/g, '').slice(-10);
  const allowed = raw.split(',').map((n) => last10(n)).filter(Boolean);
  return allowed.includes(last10(to));
}

/** Built once per process, and only when the credentials are actually present. */
let cachedClient: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return null;
  if (!cachedClient) cachedClient = twilio(sid, token);
  return cachedClient;
}

export async function sendSms(to: string | null, body: string): Promise<SmsResult> {
  if (!to) return { skipped: true, reason: 'no usable phone number' };

  if (!isAllowed(to)) {
    console.warn(`[sms] skipped ${to}: not in SMS_ALLOWLIST`);
    return { skipped: true, reason: 'not in SMS_ALLOWLIST' };
  }

  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  const client = getClient();

  if (!client || !from) {
    // Development without Twilio credentials is a supported state, not an error.
    console.warn('[sms] skipped: Twilio credentials or sender number not configured');
    return { skipped: true, reason: 'twilio not configured' };
  }

  try {
    const message = await client.messages.create({ to, from, body });
    console.log(`[sms] sent ${message.sid} to ${to}`);
    return { sid: message.sid };
  } catch (e) {
    // Trial accounts reject unverified recipients; that is expected in demos
    // and must stay a warning rather than an exception.
    const reason = (e as Error)?.message || 'unknown Twilio error';
    console.warn(`[sms] failed to ${to}: ${reason}`);
    return { error: reason };
  }
}

/**
 * SMS is charged per 160-character segment and read on a feature phone, so the
 * alert is trimmed to the facts that let someone decide: who wants what, how
 * many, at what price, and the one key that answers.
 */
export function buildDemandSms(opts: {
  buyerName?: string | null;
  quantity: number;
  craftType: string;
  location?: string | null;
  priceLabel: string;
}): string {
  const { buyerName, quantity, craftType, location, priceLabel } = opts;
  const buyer = (buyerName || 'A buyer').slice(0, 24);
  const where = location ? ` in ${location}` : '';

  const body = `KARIGARI: ${buyer} wants ${quantity} ${craftType}${where} at ${priceLabel}. Reply 1 to accept, 2 to skip.`;
  return body.length <= 160 ? body : `${body.slice(0, 157)}...`;
}
