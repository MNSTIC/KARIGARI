import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { COOKIE, clearCookie, setSignedCookie, takeCookie, type GoogleOauthState } from '@/lib/authCookies';
import { GOOGLE_CONFIGURED, exchangeCode, verifyIdToken } from '@/lib/googleAuth';
import { issueSession } from '@/lib/authSession';
import { createGoogleUser } from '@/lib/googleSignup';
import { dashboardFor } from '@/lib/dashboardRoutes';
import { isSignupRole, validateSignup } from '@/lib/registrationRules';

/** Reads cookies and query state, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Step 2 of Google sign-in: everything that decides whether a session is issued.
 *
 * Nothing on this path returns a stack trace or a 500 page. Someone hitting a
 * failure here is a person trying to sign in, so every refusal redirects to
 * `/login?notice=<code>` and the login screen renders a friendly line from an
 * i18n key.
 *
 * The `google-oauth` cookie is consumed on the FIRST read, on every path,
 * success or failure — `takeCookie` deletes before it validates. That is what
 * makes the flow single-use: a replayed callback finds no cookie and fails the
 * state check, whether or not the first attempt worked.
 */

/** Where a refusal lands. The code drives which message the login page shows. */
function notice(req: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?notice=${code}`, req.url));
}

export async function GET(req: Request) {
  if (!GOOGLE_CONFIGURED) return notice(req, 'google_unavailable');

  const url = new URL(req.url);

  // The person pressed "cancel" at Google. Not an error; just take them back.
  if (url.searchParams.get('error')) {
    await clearCookie(COOKIE.googleOauth);
    return notice(req, 'google_cancelled');
  }

  // Read AND burn the cookie before anything is validated.
  const stashed = await takeCookie<GoogleOauthState>(COOKIE.googleOauth);
  if (!stashed) return notice(req, 'google_state');

  // THE CSRF DEFENCE. Without this, an attacker can hand a victim a callback
  // URL carrying the attacker's authorization code and bind their Google
  // identity to the victim's browser.
  const state = url.searchParams.get('state');
  if (!state || state !== stashed.state) return notice(req, 'google_state');

  const code = url.searchParams.get('code');
  if (!code) return notice(req, 'google_state');

  try {
    const exchanged = await exchangeCode(code, stashed.verifier);
    if (!exchanged.ok) return notice(req, 'google_exchange');

    // Signature first, then every claim. Skipping the signature would make the
    // claim checks below theatre: they would all be attacker-controlled.
    const verified = await verifyIdToken(exchanged.idToken, stashed.nonce);
    if (!verified.ok) {
      console.warn('[auth/google/callback] id_token rejected:', verified.reason);
      return notice(req, 'google_token');
    }
    const identity = verified.identity;

    // ---- The three-way fork ------------------------------------------------

    // 1. A returning Google user, matched on `sub` — never on email, because a
    //    Google address can change hands and `sub` cannot.
    const byGoogleId = await prisma.user.findUnique({
      where: { googleId: identity.sub },
      select: { id: true, role: true },
    });
    if (byGoogleId) {
      await issueSession(byGoogleId);
      return NextResponse.redirect(new URL(dashboardFor(byGoogleId.role), req.url));
    }

    // 2. The email already belongs to a password account. REFUSE.
    //
    //    Auto-linking here would mean: control the Gmail, take the KARIGARI
    //    account. That is a full takeover for anyone whose sign-up address is a
    //    Google one they no longer control, or whose Workspace domain recycled
    //    it. Linking is a deliberate action that belongs behind an existing
    //    authenticated session, and that flow does not exist yet.
    //
    //    Nothing is mutated and no session is issued.
    const byEmail = await prisma.user.findUnique({
      where: { email: identity.email },
      select: { id: true, authProvider: true },
    });
    if (byEmail) {
      return notice(req, 'existing_password_account');
    }

    // 3. Nobody at all — a new account.
    //
    //    An ADMIN is finished right here. `validateSignup` returns
    //    `artisanProfile: null` for an admin, so there is literally nothing
    //    left to collect: sending them to the completion screen would be a form
    //    with no fields, and — worse — it would mean a pending cookie existed
    //    with ADMIN in it at all. Only ARTISAN ever gets one.
    const role = isSignupRole(stashed.role) ? stashed.role : 'ARTISAN';

    if (role === 'ADMIN') {
      const validated = validateSignup({ name: identity.name, role: 'ADMIN' });
      if (!validated.ok) {
        console.error('[auth/google/callback] admin validation failed:', validated.error);
        return notice(req, 'google_failed');
      }

      const outcome = await createGoogleUser(identity, validated.value);
      if (!outcome.ok) {
        return notice(req, outcome.reason === 'clash' ? 'existing_password_account' : 'google_failed');
      }

      await issueSession(outcome.user);
      return NextResponse.redirect(new URL(dashboardFor(outcome.user.role), req.url));
    }

    //    An ARTISAN needs six fields Google cannot supply — craftType,
    //    location, experienceYears, aadhaarLast4, annualIncome, gender — so
    //    park the verified identity in a short-lived signed cookie and collect
    //    the rest on the next screen.
    //
    //    The role travels IN THE COOKIE, never in the URL. It used to ride on
    //    `?role=`, which is attacker-controlled: opening
    //    `/register/complete?role=ADMIN` was enough to mint an admin account.
    await setSignedCookie(
      COOKIE.pendingSignup,
      {
        sub: identity.sub,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        role,
      },
      'pending'
    );

    return NextResponse.redirect(new URL('/register/complete', req.url));
  } catch (error) {
    console.error('[auth/google/callback] unexpected failure:', error);
    return notice(req, 'google_failed');
  }
}
