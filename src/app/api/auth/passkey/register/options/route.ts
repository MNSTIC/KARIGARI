import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { COOKIE, setSignedCookie } from '@/lib/authCookies';
import { getSession } from '@/lib/authSession';
import { PASSKEY_CONFIGURED, buildRegistrationOptions } from '@/lib/passkey';

export const dynamic = 'force-dynamic';

/**
 * Enrolment, leg 1: ask the browser to create a credential.
 *
 * The `userId` comes from the session and NEVER from the request body. That is
 * the whole defence against enrolling a passkey onto somebody else's account:
 * if the caller could name the target user, anyone could add their own
 * authenticator to any account they knew the id of. The challenge cookie is
 * bound to the same id and re-asserted on the verify leg.
 *
 * A signed-in session is the ONLY way in, including for the optional "set up a
 * passkey" step at the end of a Google sign-up: `/api/auth/google/complete`
 * issues the session before that step is offered, so by the time this route is
 * called the account exists and is signed in. There is deliberately no
 * enrolment path for an account that does not exist yet — a credential with
 * nothing to attach to would have to be held somewhere, and that somewhere
 * would be a new way to get a passkey onto the wrong user.
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
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, name: true, authProvider: true },
      });
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      // The gate from the brief. A password account keeps its password and
      // gains nothing here — and this keeps the blast radius small: an existing
      // account cannot acquire a second credential path without a deliberate
      // linking flow, which does not exist yet.
      if (user.authProvider === 'PASSWORD') {
        return NextResponse.json(
          {
            error:
              'Passkeys are available on accounts created with Google sign-in. Your existing account continues to use its password.',
          },
          { status: 403 }
        );
      }

      const existing = await prisma.passkey.findMany({
        where: { userId: user.id },
        select: { credentialId: true, publicKey: true, counter: true, transports: true },
      });

      const options = await buildRegistrationOptions({
        userId: user.id,
        userName: user.email,
        displayName: user.name,
        existing,
      });

      await setSignedCookie(
        COOKIE.webauthnChallenge,
        { challenge: options.challenge, userId: user.id },
        'webauthn'
      );

      return NextResponse.json({ success: true, options });
    }
  } catch (error) {
    console.error('[passkey/register/options] failed:', error);
    return NextResponse.json({ error: 'Could not start passkey setup.' }, { status: 500 });
  }
}
