import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/**
 * The one place a KARIGARI session is minted and read.
 *
 * `/api/auth/login` and `/api/auth/register` each carried their own copy of the
 * same eight lines — the same secret fallback, the same 7-day expiry, the same
 * cookie flags. V10 adds four more sign-in paths (Google callback, Google
 * complete, passkey login, passkey register), and six copies of a security
 * control is six chances for one of them to quietly disagree about `httpOnly`.
 *
 * This is a refactor, not a change: the token payload, the expiry, the cookie
 * name and every flag are byte-for-byte what the two existing routes already
 * set. A session issued before V10 is still valid, and one issued after is
 * indistinguishable from it.
 */

/** Cookie name, unchanged since the first version of this app. */
export const AUTH_COOKIE = 'auth-token';

/** Seven days, in seconds. Matches the JWT's own `expiresIn`. */
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The signing secret.
 *
 * The `'fallback-secret'` default is inherited deliberately: every existing
 * route uses it, and removing it here while the older routes keep it would mean
 * a token signed by one and rejected by another. It is a development
 * convenience and a production footgun, which is why the warning below fires.
 */
function secret(): string {
  const configured = process.env.JWT_SECRET;
  if (!configured && process.env.NODE_ENV === 'production') {
    console.error(
      '[auth] JWT_SECRET is not set in production. Sessions are being signed with the shared development fallback, which anyone reading this repository can forge. Set JWT_SECRET.'
    );
  }
  return configured || 'fallback-secret';
}

export interface SessionUser {
  id: string;
  role: string;
}

export interface Session {
  userId: string;
  role: string;
}

/**
 * Sign a fresh session and set the cookie.
 *
 * Always a NEW token — nothing here ever reuses or extends an existing one, so
 * a session cannot be fixated across a provider switch.
 */
export async function issueSession(user: SessionUser): Promise<string> {
  const token = jwt.sign({ userId: user.id, role: user.role }, secret(), { expiresIn: '7d' });

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });

  return token;
}

/**
 * The current session, or null.
 *
 * Null covers every failure — no cookie, a malformed token, a bad signature, an
 * expired one — because a caller has the same job in all four cases. Callers
 * that need to distinguish "not signed in" from "signed in as the wrong role"
 * check `role` themselves; `requireArtisan()` in src/lib/artisanAuth.ts still
 * owns the artisan gate and is unchanged.
 */
export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE)?.value;
    if (!token) return null;

    const decoded = jwt.verify(token, secret()) as { userId?: unknown; role?: unknown };
    if (typeof decoded.userId !== 'string' || typeof decoded.role !== 'string') return null;

    return { userId: decoded.userId, role: decoded.role };
  } catch {
    return null;
  }
}

/** Clear the session cookie. The whole of logout. */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
}
