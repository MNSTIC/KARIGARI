import { NextResponse } from 'next/server';
import { COOKIE, setSignedCookie } from '@/lib/authCookies';
import { PASSKEY_CONFIGURED, buildAuthenticationOptions } from '@/lib/passkey';

export const dynamic = 'force-dynamic';

/**
 * Sign-in, leg 1: hand the browser a challenge.
 *
 * Public, and deliberately usernameless. No email is asked for and no
 * `allowCredentials` list is sent, so the authenticator offers whichever
 * discoverable credential it holds for this site and the credential itself
 * tells us who the person is on the verify leg.
 *
 * That also means this route reveals nothing. It does not touch the database
 * and its response is identical whether or not any account exists — there is no
 * email to probe with, so there is no enumeration surface here at all.
 *
 * The challenge cookie carries NO `userId`, unlike enrolment: nobody has
 * claimed an identity yet.
 */
export async function POST() {
  if (!PASSKEY_CONFIGURED) {
    return NextResponse.json(
      {
        error:
          'Passkeys are not configured on this deployment. Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN to enable them.',
      },
      { status: 503 }
    );
  }

  try {
    const options = await buildAuthenticationOptions();
    await setSignedCookie(COOKIE.webauthnChallenge, { challenge: options.challenge }, 'webauthn');
    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error('[passkey/login/options] failed:', error);
    return NextResponse.json({ error: 'Could not start passkey sign-in.' }, { status: 500 });
  }
}
