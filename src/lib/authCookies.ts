import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/**
 * The short-lived, single-use cookies the OAuth and WebAuthn ceremonies need.
 *
 * WHY COOKIES RATHER THAN A TABLE. The values here are single-use and live for
 * five minutes. A DB row would mean two extra round-trips on the hot path of
 * every sign-in, plus a cleanup job for abandoned ceremonies that nobody would
 * write, plus a table that grows forever on a demo deployment. Signed cookies
 * expire on their own and leave nothing behind.
 *
 * WHY SIGNED. The `state` and `nonce` must be unforgeable — an attacker who can
 * set the cookie can complete a CSRF. Signing with `JWT_SECRET` makes tampering
 * detectable, and `httpOnly` keeps the value away from scripts.
 *
 * WHY `sameSite: 'lax'` AND NOT `'strict'`. Google's callback is a cross-site
 * top-level GET. `strict` would withhold the cookie on precisely the request
 * that needs it, and the flow would fail as a state mismatch every time. `lax`
 * sends it on top-level navigations, which is this case and is not a form POST
 * from an attacker's page.
 *
 * SINGLE USE is enforced by reading and DELETING before validating — see
 * `takeCookie`. A replay therefore finds nothing and is rejected as a mismatch,
 * whether the first attempt succeeded or failed.
 */

const TTL = {
  /** Long enough to pick an account and type a password at Google. */
  google: 5 * 60,
  /** Long enough to fill the artisan fields on the completion screen. */
  pending: 10 * 60,
  /** A WebAuthn ceremony is seconds; five minutes is already generous. */
  webauthn: 5 * 60,
} as const;

export const COOKIE = {
  googleOauth: 'google-oauth',
  pendingSignup: 'pending-signup',
  webauthnChallenge: 'webauthn-challenge',
} as const;

/**
 * Scoped paths, so these are not attached to every request in the app.
 *
 * `pendingSignup` needs `/` because `/register/complete` is a page rather than
 * an API route, and the browser must send it there.
 */
const PATHS: Record<string, string> = {
  [COOKIE.googleOauth]: '/api/auth/google',
  [COOKIE.pendingSignup]: '/',
  [COOKIE.webauthnChallenge]: '/api/auth/passkey',
};

function secret(): string {
  return process.env.JWT_SECRET || 'fallback-secret';
}

export interface GoogleOauthState {
  state: string;
  verifier: string;
  nonce: string;
  role: string;
}

export interface PendingSignup {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface WebauthnChallenge {
  challenge: string;
  /**
   * Present for enrolment, absent for a usernameless login.
   *
   * This binding is what stops a passkey being enrolled onto someone else's
   * account: the verify leg re-reads it from here and asserts it matches the
   * session, so a `userId` in the request body is never trusted.
   */
  userId?: string;
}

type Payload = GoogleOauthState | PendingSignup | WebauthnChallenge;

/** Sign a payload and set it, with the flags and TTL for that cookie. */
export async function setSignedCookie(
  name: (typeof COOKIE)[keyof typeof COOKIE],
  payload: Payload,
  kind: keyof typeof TTL
): Promise<void> {
  const token = jwt.sign(payload, secret(), { expiresIn: TTL[kind] });
  const cookieStore = await cookies();
  cookieStore.set(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: PATHS[name],
    maxAge: TTL[kind],
  });
}

/**
 * Read a signed cookie AND delete it, in that order.
 *
 * The delete happens before validation on purpose: a replayed request must fail
 * even when the first attempt failed too, so the value is burned on sight
 * rather than on success.
 *
 * Returns null for every failure — absent, tampered, expired — because a caller
 * does the same thing in all three cases.
 *
 * The TTL is enforced twice: the browser stops sending an expired cookie, and
 * the signed payload's own `exp` refuses it even if a client replays a value it
 * saved. The second is the one that actually matters.
 */
export async function takeCookie<T extends Payload>(
  name: (typeof COOKIE)[keyof typeof COOKIE]
): Promise<T | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(name)?.value;
  cookieStore.delete({ name, path: PATHS[name] });
  if (!raw) return null;

  try {
    return jwt.verify(raw, secret()) as T;
  } catch {
    return null;
  }
}

/**
 * Read a signed cookie WITHOUT consuming it.
 *
 * Only for `pending-signup`, which the completion page reads to render the
 * Google name and avatar before the person has submitted anything. The POST
 * that actually creates the account uses `takeCookie` and burns it.
 */
export async function peekCookie<T extends Payload>(
  name: (typeof COOKIE)[keyof typeof COOKIE]
): Promise<T | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(name)?.value;
  if (!raw) return null;
  try {
    return jwt.verify(raw, secret()) as T;
  } catch {
    return null;
  }
}

/** Drop a cookie without reading it. Used on every OAuth failure path. */
export async function clearCookie(name: (typeof COOKIE)[keyof typeof COOKIE]): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name, path: PATHS[name] });
}
