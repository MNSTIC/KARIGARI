import { NextResponse } from 'next/server';
import { COOKIE, takeCookie, type PendingSignup } from '@/lib/authCookies';
import { issueSession } from '@/lib/authSession';
import { createGoogleUser } from '@/lib/googleSignup';
import { dashboardFor } from '@/lib/dashboardRoutes';
import { validateSignup } from '@/lib/registrationRules';

/** Reads cookies and creates a session, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Step 3 of Google sign-in: create the artisan account.
 *
 * The identity in the `pending-signup` cookie was verified against Google's own
 * signature in the callback, so the email, `sub` and role here are trustworthy.
 * What arrives in the body is not — it is whatever the browser posted — and it
 * goes through `validateSignup()`, the SAME rules `/api/auth/register` uses.
 *
 * Only an ARTISAN ever reaches this route. An admin sign-up is completed in the
 * callback, because `validateSignup` returns no profile for an admin and there
 * would be nothing to collect.
 */
export async function POST(req: Request) {
  try {
    // Burn the cookie on read. A double-submit finds nothing and gets a 401
    // rather than creating a second account.
    const pending = await takeCookie<PendingSignup>(COOKIE.pendingSignup);
    if (!pending?.sub || !pending?.email) {
      return NextResponse.json(
        { error: 'Your Google sign-in has expired. Please start again.', expired: true },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // THE ORDER OF THESE KEYS IS A SECURITY CONTROL, NOT A STYLE CHOICE.
    //
    // `...body` is spread FIRST and `role` is written AFTER it, so a `role` in
    // the request body is overwritten by the one from the signed cookie and can
    // never reach `validateSignup`. Swap the two lines and the browser decides
    // the privilege level of the account being created. `pending.role` is
    // server-authored and JWT-signed; `body.role` is whatever was POSTed.
    //
    // `name` is likewise pinned after the spread, but only so a blank
    // submission falls back to what Google gave us. That one is a convenience.
    // This one is not.
    const validation = validateSignup({
      ...body,
      name: body?.name || pending.name,
      role: pending.role,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const outcome = await createGoogleUser(
      { sub: pending.sub, email: pending.email, picture: pending.picture },
      validation.value
    );

    if (!outcome.ok) {
      if (outcome.reason === 'clash') {
        return NextResponse.json(
          {
            error:
              'An account already exists for this email. Please sign in with your password for now.',
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: 'Could not finish creating your account.' },
        { status: 500 }
      );
    }

    await issueSession(outcome.user);

    return NextResponse.json({
      success: true,
      user: { id: outcome.user.id, name: outcome.user.name, role: outcome.user.role },
      /** Where the client should land. Never `/admin/dashboard`, which does not exist. */
      redirectTo: dashboardFor(outcome.user.role),
    });
  } catch (error) {
    console.error('[auth/google/complete] failed:', error);
    return NextResponse.json({ error: 'Could not finish creating your account.' }, { status: 500 });
  }
}
