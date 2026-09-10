import { NextResponse } from 'next/server';
import { COOKIE, peekCookie, type PendingSignup } from '@/lib/authCookies';

export const dynamic = 'force-dynamic';

/**
 * What the completion screen renders at the top: the Google name, email and
 * avatar of the sign-up in progress.
 *
 * PEEKED, not consumed. The cookie is single-use and burning it here would
 * strand the person on a form they can no longer submit — the POST to
 * `/api/auth/google/complete` is what actually spends it.
 *
 * The cookie is httpOnly, so the page cannot read it itself; this is the only
 * way that screen learns whose sign-up it is finishing.
 *
 * TWO FIELDS ARE WITHHELD ON PURPOSE. `sub` is the Google identifier the account
 * is created against and the browser has no use for it. `role` is withheld
 * because nothing in the browser may participate in choosing a privilege level —
 * `/api/auth/google/complete` reads it straight from this same cookie. Returning
 * it here would invite a future edit to echo it back in the POST body, which is
 * exactly the hole the cookie was introduced to close. Do not add either.
 */
export async function GET() {
  const pending = await peekCookie<PendingSignup>(COOKIE.pendingSignup);
  if (!pending?.email) {
    return NextResponse.json({ error: 'No sign-up in progress.' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    pending: {
      email: pending.email,
      name: pending.name,
      picture: pending.picture,
    },
  });
}
