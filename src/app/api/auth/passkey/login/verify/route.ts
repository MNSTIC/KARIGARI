import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { COOKIE, takeCookie, type WebauthnChallenge } from '@/lib/authCookies';
import { issueSession } from '@/lib/authSession';
import {
  PASSKEY_CONFIGURED,
  checkAuthenticationResponse,
  counterRegressed,
} from '@/lib/passkey';

export const dynamic = 'force-dynamic';

/**
 * Sign-in, leg 2: check the assertion and issue a session.
 *
 * The credential decides who the user is — it is looked up by `credentialId`,
 * which is unique across the table, so one authenticator can only ever resolve
 * to one account.
 *
 * Two things make a stolen or copied credential useless here: the challenge is
 * single-use and expires in five minutes, and the signature counter must have
 * advanced. The counter is the only clone detection WebAuthn offers, and it is
 * the reason a cloned authenticator shows up at all.
 */
export async function POST(req: Request) {
  if (!PASSKEY_CONFIGURED) {
    return NextResponse.json({ error: 'Passkeys are not configured.' }, { status: 503 });
  }

  try {
    // Burned on read. A replayed assertion finds no challenge and fails here,
    // before any cryptography runs.
    const stashed = await takeCookie<WebauthnChallenge>(COOKIE.webauthnChallenge);
    if (!stashed?.challenge) {
      return NextResponse.json(
        { error: 'That sign-in attempt has expired. Please try again.' },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const credentialId = typeof body?.response?.id === 'string' ? body.response.id : '';
    if (!credentialId) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const stored = await prisma.passkey.findUnique({
      where: { credentialId },
      select: {
        id: true,
        credentialId: true,
        publicKey: true,
        counter: true,
        transports: true,
        user: { select: { id: true, role: true, accountStatus: true } },
      },
    });
    // Same generic message an unknown email gets on the password route. A
    // distinct "no such passkey" would confirm which credentials exist.
    if (!stored) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    if (stored.user.accountStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const verification = await checkAuthenticationResponse({
      response: body.response,
      expectedChallenge: stashed.challenge,
      credential: {
        credentialId: stored.credentialId,
        publicKey: stored.publicKey,
        counter: stored.counter,
        transports: stored.transports,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const returned = verification.authenticationInfo.newCounter;
    if (counterRegressed(stored.counter, returned)) {
      // A genuine authenticator's counter only ever increases. This one did not,
      // which means the credential was cloned or the assertion replayed. Loud in
      // the log, generic to the caller.
      console.error(
        `[passkey/login/verify] counter regression on credential ${stored.id}: stored ${stored.counter}, returned ${returned}. Possible cloned authenticator.`
      );
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    await prisma.passkey.update({
      where: { id: stored.id },
      data: { counter: returned, lastUsedAt: new Date() },
    });

    await issueSession(stored.user);

    return NextResponse.json({
      success: true,
      role: stored.user.role,
    });
  } catch (error) {
    console.error('[passkey/login/verify] failed:', error);
    return NextResponse.json({ error: 'Could not complete passkey sign-in.' }, { status: 500 });
  }
}
