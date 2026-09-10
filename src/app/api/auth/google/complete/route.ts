import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { COOKIE, takeCookie, type PendingSignup } from '@/lib/authCookies';
import { issueSession } from '@/lib/authSession';
import { validateSignup } from '@/lib/registrationRules';

/** Reads cookies and creates a session, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Step 3 of Google sign-in: create the account.
 *
 * The identity in the `pending-signup` cookie was verified against Google's own
 * signature in the callback, so the email and `sub` here are trustworthy. What
 * arrives in the body is not — it is the artisan fields the person typed on the
 * completion screen, and it goes through `validateSignup()`, the SAME rules
 * `/api/auth/register` uses. Two screens creating accounts with two copies of
 * the rules would drift the first time one gained a field.
 */
export async function POST(req: Request) {
  try {
    // Burn the cookie on read. A double-submit finds nothing and gets a 401
    // rather than creating a second account.
    const pending = await takeCookie<PendingSignup>(COOKIE.pendingSignup);
    if (!pending?.sub || !pending?.email) {
      return NextResponse.json(
        { error: 'Your Google sign-in has expired. Please start again.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // The name defaults to what Google gave us, so someone who leaves it alone
    // still gets a real name rather than an empty string.
    const validation = validateSignup({ ...body, name: body?.name || pending.name });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { name, role, artisanProfile } = validation.value;

    // Re-checked INSIDE the transaction. The cookie is up to ten minutes old,
    // and the fork decision made in the callback is stale by now — somebody may
    // have registered this email by password in the meantime. The unique
    // constraints are the real guarantee; this turns a Prisma exception into a
    // message a person can act on.
    const user = await prisma.$transaction(async (tx) => {
      const clash = await tx.user.findFirst({
        where: { OR: [{ email: pending.email }, { googleId: pending.sub }] },
        select: { id: true },
      });
      if (clash) return null;

      return tx.user.create({
        data: {
          name,
          email: pending.email,
          // No password exists for this identity, and none is invented. The
          // login route refuses a null hash before it ever reaches bcrypt.
          passwordHash: null,
          authProvider: 'GOOGLE',
          googleId: pending.sub,
          // Google asserted it. We record what we were told, not what we checked.
          emailVerified: true,
          avatarUrl: pending.picture,
          role,
          ...(artisanProfile ? { artisanProfile: { create: artisanProfile } } : {}),
        },
        select: { id: true, name: true, role: true },
      });
    });

    if (!user) {
      return NextResponse.json(
        {
          error:
            'An account already exists for this email. Please sign in with your password for now.',
        },
        { status: 409 }
      );
    }

    await issueSession(user);

    return NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (error) {
    // A unique-constraint violation here means the race above was lost between
    // the check and the insert. It is a 409, not a 500 — the person can act on it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'An account already exists for this email.' },
        { status: 409 }
      );
    }
    console.error('[auth/google/complete] failed:', error);
    return NextResponse.json({ error: 'Could not finish creating your account.' }, { status: 500 });
  }
}
