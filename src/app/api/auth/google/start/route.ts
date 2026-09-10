import { NextResponse } from 'next/server';
import { COOKIE, setSignedCookie } from '@/lib/authCookies';
import {
  GOOGLE_CONFIGURED,
  buildAuthUrl,
  createNonce,
  createPkcePair,
  createState,
} from '@/lib/googleAuth';
import { isSignupRole } from '@/lib/registrationRules';

/** Sets a cookie and redirects, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Step 1 of Google sign-in: send the browser to Google.
 *
 * Everything that makes the callback safe is generated here and stashed in one
 * signed httpOnly cookie: the `state` that defeats CSRF, the PKCE `verifier`
 * that makes a stolen authorization code useless, and the `nonce` that binds the
 * returned `id_token` to this specific attempt.
 *
 * The requested role rides along because Google cannot tell us whether someone
 * is signing up as an artisan or an admin, and asking again after the round
 * trip would lose the answer they already gave on the login screen.
 */
export async function GET(req: Request) {
  if (!GOOGLE_CONFIGURED) {
    // Plainly, rather than redirecting to a Google page that will reject us.
    // The rest of the app — including password sign-in — is unaffected.
    return NextResponse.json(
      {
        error:
          'Google sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to enable it.',
      },
      { status: 503 }
    );
  }

  try {
    const requested = new URL(req.url).searchParams.get('role');
    // Anything unrecognised becomes ARTISAN: it is the role this app exists
    // for, and it is the one whose extra fields the completion screen collects.
    const role = isSignupRole(requested) ? requested : 'ARTISAN';

    const { verifier, challenge } = createPkcePair();
    const state = createState();
    const nonce = createNonce();

    await setSignedCookie(COOKIE.googleOauth, { state, verifier, nonce, role }, 'google');

    return NextResponse.redirect(buildAuthUrl({ state, nonce, challenge }));
  } catch (error) {
    console.error('[auth/google/start] failed to begin the flow:', error);
    return NextResponse.json({ error: 'Could not start Google sign-in.' }, { status: 500 });
  }
}
