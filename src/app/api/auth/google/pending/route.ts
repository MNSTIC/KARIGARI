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
 * way that screen learns whose sign-up it is finishing. `sub` is deliberately
 * NOT returned: the browser has no use for the Google identifier, and it is the
 * key the account is created against.
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
