import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/**
 * The one place a KARIGARI session is minted and read.
 *
 * `/api/auth/login` and `/api/auth/register` each carried their own copy of the
 * same eight lines — the same secret fallback, the same expiry, the same cookie
 * flags. V10 added four more sign-in paths (Google callback, Google complete,
 * passkey login, passkey register), and six copies of a security control is six
 * chances for one of them to quietly disagree about `httpOnly`.
 *
 * STAY-SIGNED-IN. Sessions used to be a flat seven days from the moment of
 * login, which meant an artisan who used the app every single day was still
 * thrown back to the login screen every Monday. That is not how the apps they
 * already use behave, and for someone signing in on a shared phone in a weak
 * signal area it is a real barrier, not a mild annoyance.
 *
 * Two things fix that, and both are needed:
 *   1. A LONG window (`MAX_AGE_SECONDS`), so closing the browser — or the phone
 *      dying — does not end the session. This part already worked: the cookie
 *      has always carried `maxAge`, which is what makes it survive a restart.
 *   2. A SLIDING one (`renewSession`), so the window is measured from the last
 *      visit rather than from the first. Without this, a year-long cookie is
 *      still a hard wall; it just moves the wall further out.
 *
 * The result is the behaviour people expect from YouTube or Instagram: you stay
 * signed in as long as you keep coming back, and you are only asked again after
 * a genuinely long absence, a logout, or a `JWT_SECRET` rotation.
 *
 * THE TRADE, STATED PLAINLY. A longer session is a longer window in which a
 * stolen cookie is worth something, and this app holds Aadhaar last-4, income
 * figures and payout settlement. The mitigations that make this acceptable are
 * `httpOnly` (script cannot read it), `secure` in production (it never crosses
 * plain HTTP), `sameSite: 'lax'` (it is not sent on cross-site form POSTs), and
 * logout clearing it server-side. What this app does NOT yet have is per-device
 * session revocation — a "sign out everywhere" needs a stored session table or
 * a per-user token version, and until it exists the only revocation is rotating
 * `JWT_SECRET`, which signs everyone out at once.
 */

/** Cookie name, unchanged since the first version of this app. */
export const AUTH_COOKIE = 'auth-token';

/**
 * One year.
 *
 * Chosen to be longer than any plausible gap between visits for someone who
 * uses this app as their shopfront, so the sliding renewal below effectively
 * never lets an active account lapse. It is the ceiling for an ABANDONED
 * session, not the typical lifetime of an active one.
 */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Re-issue a session once it is older than this.
 *
 * A day, rather than on every single request, because re-signing sets a cookie
 * on the response and there is no reason to do that dozens of times an hour.
 * One touch per day is enough to keep a daily user's window permanently ahead
 * of the expiry, and it keeps `Set-Cookie` off the overwhelming majority of
 * responses.
 */
const RENEW_AFTER_SECONDS = 24 * 60 * 60;

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
  /**
   * When this token was signed, as a UNIX second.
   *
   * Only `renewSession` needs it. Zero when a token predates the claim, which
   * is treated as "old enough to renew" rather than as an error — that is what
   * upgrades a legacy seven-day session to a sliding one on first contact.
   */
  issuedAt: number;
}

/**
 * Sign a fresh session and set the cookie.
 *
 * Always a NEW token — nothing here ever reuses or extends an existing one, so
 * a session cannot be fixated across a provider switch.
 *
 * MUST be called from a Route Handler or a Server Action. Next forbids setting
 * a cookie while rendering a Server Component, and this throws if you try.
 */
export async function issueSession(user: SessionUser): Promise<string> {
  const token = jwt.sign({ userId: user.id, role: user.role }, secret(), {
    expiresIn: MAX_AGE_SECONDS,
  });

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
 * READ ONLY, and deliberately so: this is called from Server Components as well
 * as Route Handlers, and it must stay safe to call during a render. The sliding
 * refresh lives in `renewSession`, which callers that CAN set cookies invoke
 * separately.
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

    const decoded = jwt.verify(token, secret()) as {
      userId?: unknown;
      role?: unknown;
      iat?: unknown;
    };
    if (typeof decoded.userId !== 'string' || typeof decoded.role !== 'string') return null;

    return {
      userId: decoded.userId,
      role: decoded.role,
      issuedAt: typeof decoded.iat === 'number' ? decoded.iat : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Slide the session window forward if the token is getting old.
 *
 * This is what turns a fixed one-year expiry into "signed in as long as you
 * keep using it". Call it from any Route Handler that already runs on a normal
 * visit — `/api/auth/session` and `/api/auth/me` both do, and between them they
 * cover every dashboard load.
 *
 * Three properties worth keeping:
 *   - It NEVER extends a session that has already expired. `getSession()` has
 *     verified `exp` before we get here, so an expired token returns null and
 *     never reaches this function. Expiry still means expiry.
 *   - It re-signs rather than re-dating, so the new token is a genuine fresh
 *     credential rather than a rewritten old one.
 *   - It swallows its own failures. A session refresh is a convenience; if it
 *     cannot set the cookie (called during a render, say) the caller's real
 *     work must still succeed, and the person simply keeps the window they had.
 *
 * Returns whether it actually renewed, which is useful in tests and in logs.
 */
export async function renewSession(session: Session): Promise<boolean> {
  const ageSeconds = Math.floor(Date.now() / 1000) - session.issuedAt;
  if (ageSeconds < RENEW_AFTER_SECONDS) return false;

  try {
    await issueSession({ id: session.userId, role: session.role });
    return true;
  } catch (error) {
    console.error('[auth] could not slide the session window:', error);
    return false;
  }
}

/** Clear the session cookie. The whole of logout. */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  /**
   * Deleted with the SAME path it was written with. A `delete` whose path does
   * not match the original leaves the cookie in place, and logout silently does
   * nothing — the classic version of this bug.
   */
  cookieStore.delete({ name: AUTH_COOKIE, path: '/' });
}
