import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

/**
 * WebAuthn, wrapped once.
 *
 * The four ceremony helpers live here rather than in the route handlers so the
 * options — which are a security policy, not configuration — are stated in one
 * place. Four routes each choosing their own `userVerification` would be four
 * chances to quietly weaken the thing.
 */

const RP_ID = (process.env.WEBAUTHN_RP_ID || '').trim();
const RP_NAME = (process.env.WEBAUTHN_RP_NAME || 'KARIGARI').trim();
const ORIGIN = (process.env.WEBAUTHN_ORIGIN || '').trim();

/** Both halves present. False → the routes 503 and the button never renders. */
export const PASSKEY_CONFIGURED = Boolean(RP_ID && ORIGIN);

export const WEBAUTHN_RP_ID = RP_ID;
export const WEBAUTHN_ORIGIN = ORIGIN;

/**
 * The mismatch that costs an afternoon.
 *
 * `rpID` must be the registrable suffix of the origin's hostname. When it is
 * not, every ceremony fails inside the browser with a `SecurityError` that
 * surfaces as "something went wrong" — it looks like a UI bug, not a config
 * one. Shouting at import time is the cheapest way to make it obvious.
 */
if (PASSKEY_CONFIGURED) {
  try {
    const originHost = new URL(ORIGIN).hostname;
    if (originHost !== RP_ID && !originHost.endsWith(`.${RP_ID}`)) {
      console.error(
        `[passkey] WEBAUTHN_RP_ID ("${RP_ID}") is not the hostname of WEBAUTHN_ORIGIN ("${originHost}"). Every passkey ceremony will fail in the browser. RP_ID must be the bare hostname, or a registrable parent of it.`
      );
    }
  } catch {
    console.error(`[passkey] WEBAUTHN_ORIGIN is not a valid URL: "${ORIGIN}"`);
  }
}

/**
 * Shared policy for both ceremonies.
 *
 * `userVerification: 'preferred'` and not `'required'`: a hardware key with no
 * PIN is still an enormous improvement on a password, and requiring UV would
 * silently exclude those users with an error they cannot act on.
 *
 * `residentKey: 'preferred'` gives usernameless login where the authenticator
 * supports it, without shutting out older keys that cannot store a credential.
 *
 * `attestation: 'none'`: this app has no attestation policy to enforce, so
 * asking for one would collect device-model information for nothing.
 */
const AUTHENTICATOR_SELECTION = {
  residentKey: 'preferred',
  requireResidentKey: false,
  userVerification: 'preferred',
} as const;

export interface StoredCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

/** Options for enrolling a new credential on a known user. */
export async function buildRegistrationOptions(opts: {
  userId: string;
  userName: string;
  displayName: string;
  existing: StoredCredential[];
}) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(opts.userId),
    userName: opts.userName,
    userDisplayName: opts.displayName,
    attestationType: 'none',
    authenticatorSelection: AUTHENTICATOR_SELECTION,
    // So the browser can say "you already registered this key" rather than
    // silently creating a second credential the user cannot tell apart.
    excludeCredentials: opts.existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as never,
    })),
  });
}

export async function checkRegistrationResponse(opts: {
  response: Parameters<typeof verifyRegistrationResponse>[0]['response'];
  expectedChallenge: string;
}) {
  return verifyRegistrationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
  });
}

/**
 * Options for signing in.
 *
 * `allowCredentials` is left empty for a usernameless attempt: the authenticator
 * offers whichever discoverable credential it holds for this RP, and the
 * credential itself tells us who the user is. Passing a list would require
 * knowing the user first, which is the thing passkeys exist to avoid.
 */
export async function buildAuthenticationOptions(allow?: StoredCredential[]) {
  return generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    ...(allow && allow.length > 0
      ? {
          allowCredentials: allow.map((c) => ({
            id: c.credentialId,
            transports: c.transports as never,
          })),
        }
      : {}),
  });
}

export async function checkAuthenticationResponse(opts: {
  response: Parameters<typeof verifyAuthenticationResponse>[0]['response'];
  expectedChallenge: string;
  credential: StoredCredential;
}) {
  return verifyAuthenticationResponse({
    response: opts.response,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
    credential: {
      id: opts.credential.credentialId,
      publicKey: Buffer.from(opts.credential.publicKey, 'base64url'),
      counter: opts.credential.counter,
      transports: opts.credential.transports as never,
    },
  });
}

/**
 * Has this authenticator's signature counter gone backwards?
 *
 * A genuine authenticator increments on every assertion, so a counter that did
 * not advance means the credential was cloned or the assertion replayed — the
 * only clone detection WebAuthn offers.
 *
 * The exception is load-bearing: synced platform passkeys (Apple, Google) always
 * report 0, and rejecting "was 0, still 0" would lock out every iPhone and
 * Android user. Anything else that fails to advance is refused.
 */
export function counterRegressed(stored: number, returned: number): boolean {
  if (stored === 0 && returned === 0) return false;
  return returned <= stored;
}

/**
 * A recognisable name for the credential, from the User-Agent.
 *
 * Not analytics — someone holding three passkeys needs to know which one they
 * are about to revoke, and "Chrome on Windows" answers that where a UUID does
 * not. Coarse on purpose: browser family and OS family, nothing finer.
 */
export function deviceLabelFrom(userAgent: string | null): string | null {
  const ua = (userAgent || '').trim();
  if (!ua) return null;

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;

  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser || os;
}
