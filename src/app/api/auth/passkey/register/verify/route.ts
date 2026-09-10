import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { COOKIE, takeCookie, type WebauthnChallenge } from '@/lib/authCookies';
import { getSession } from '@/lib/authSession';
import { PASSKEY_CONFIGURED, checkRegistrationResponse, deviceLabelFrom } from '@/lib/passkey';

export const dynamic = 'force-dynamic';

/**
 * Enrolment, leg 2: store the credential the browser just created.
 *
 * The `userId` is read back out of the challenge cookie and asserted equal to
 * the session's. Both legs therefore agree about who is enrolling, and neither
 * ever consults the request body for it — which is what stops a passkey being
 * attached to an account the caller does not hold.
 */
export async function POST(req: Request) {
  if (!PASSKEY_CONFIGURED) {
    return NextResponse.json({ error: 'Passkeys are not configured.' }, { status: 503 });
  }

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Single-use: burned on read, so a replayed enrolment finds no challenge.
    const stashed = await takeCookie<WebauthnChallenge>(COOKIE.webauthnChallenge);
    if (!stashed?.challenge || !stashed.userId) {
      return NextResponse.json(
        { error: 'That passkey setup has expired. Please try again.' },
        { status: 400 }
      );
    }
    if (stashed.userId !== session.userId) {
      // The challenge was issued to somebody else. Not a user error.
      console.warn(
        `[passkey/register/verify] challenge/session mismatch: ${stashed.userId} vs ${session.userId}`
      );
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, authProvider: true },
    });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Re-checked here as well as on the options leg: the two are separate
    // requests, and a caller can always skip straight to this one.
    if (user.authProvider === 'PASSWORD') {
      return NextResponse.json(
        {
          error:
            'Passkeys are available on accounts created with Google sign-in. Your existing account continues to use its password.',
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const verification = await checkRegistrationResponse({
      response: body?.response,
      expectedChallenge: stashed.challenge,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'That passkey could not be verified.' }, { status: 400 });
    }

    const { credential, credentialBackedUp } = verification.registrationInfo;

    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: (credential.transports ?? []) as string[],
        backedUp: credentialBackedUp,
        deviceLabel: deviceLabelFrom(req.headers.get('user-agent')),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // The same physical credential enrolled twice. A 409 the person can act on,
    // not a 500 — `credentialId` is unique precisely so this cannot silently
    // create a second row pointing at one authenticator.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'That passkey is already registered on this account.' },
        { status: 409 }
      );
    }
    console.error('[passkey/register/verify] failed:', error);
    return NextResponse.json({ error: 'Could not save that passkey.' }, { status: 500 });
  }
}
