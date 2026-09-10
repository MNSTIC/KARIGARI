import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ValidatedSignup } from '@/lib/registrationRules';

/**
 * Creating a KARIGARI account from a verified Google identity — the ONE writer.
 *
 * Two routes now need this. `/api/auth/google/callback` creates an ADMIN
 * outright (there is nothing further to collect for an admin, so sending them
 * to a completion screen would be a form with no fields), and
 * `/api/auth/google/complete` creates an ARTISAN once the six profile fields
 * Google cannot supply have been filled in.
 *
 * A second `user.create` in the other route would be a second place for the
 * clash re-check and the `P2002` handling to drift — and those are the two
 * things standing between a stale ten-minute-old cookie and a duplicate account.
 */

export type GoogleSignupResult =
  | { ok: true; user: { id: string; name: string; role: string } }
  | { ok: false; reason: 'clash' }
  | { ok: false; reason: 'failed' };

export interface GoogleIdentityForSignup {
  sub: string;
  email: string;
  picture: string | null;
}

/**
 * Write the user and, for an artisan, their nested profile.
 *
 * The email and `googleId` are re-checked INSIDE the transaction because the
 * caller's information is stale by the time it gets here — the callback decided
 * the email was free before redirecting, and the pending cookie can be ten
 * minutes old. The unique constraints are the real guarantee; this check turns
 * a Prisma exception into something a person can act on, and the `P2002` catch
 * covers the narrow window between the check and the insert.
 */
export async function createGoogleUser(
  identity: GoogleIdentityForSignup,
  validated: ValidatedSignup
): Promise<GoogleSignupResult> {
  try {
    const user = await prisma.$transaction(async (tx) => {
      const clash = await tx.user.findFirst({
        where: { OR: [{ email: identity.email }, { googleId: identity.sub }] },
        select: { id: true },
      });
      if (clash) return null;

      return tx.user.create({
        data: {
          name: validated.name,
          email: identity.email,
          // No password exists for this identity, and none is invented. The
          // login route refuses a null hash before it ever reaches bcrypt.
          passwordHash: null,
          authProvider: 'GOOGLE',
          googleId: identity.sub,
          // Google asserted it. We record what we were told, not what we checked.
          emailVerified: true,
          avatarUrl: identity.picture,
          role: validated.role,
          ...(validated.artisanProfile
            ? { artisanProfile: { create: validated.artisanProfile } }
            : {}),
        },
        select: { id: true, name: true, role: true },
      });
    });

    if (!user) return { ok: false, reason: 'clash' };
    return { ok: true, user };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'clash' };
    }
    console.error('[googleSignup] could not create the account:', error);
    return { ok: false, reason: 'failed' };
  }
}
