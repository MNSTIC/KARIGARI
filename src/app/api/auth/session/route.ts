import { NextResponse } from 'next/server';
import { getSession, renewSession } from '@/lib/authSession';
import { dashboardFor } from '@/lib/dashboardRoutes';

/** Reads and re-writes the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * "Am I still signed in, and where do I belong?"
 *
 * The PUBLIC pages ask this — the landing page, `/login`, `/register` — so that
 * someone who signed in last week is not shown a "Get Started" button that
 * makes them type a password they have already given. It is the same question
 * `/api/auth/me` answers, minus the database.
 *
 * WHY NOT JUST USE `/api/auth/me`. That route reads a `User` row to report
 * `authProvider`, which the profile editor needs. This one is asked on the
 * front door by every visitor, signed in or not, so it must cost nothing: a
 * cookie read and a signature check, no query. A public page hitting the
 * database on every load to render a button is the wrong trade.
 *
 * It is also where the session window SLIDES. Any visit to a page that asks
 * this question is proof the person is still around, which is exactly the
 * signal a rolling expiry should be measured from.
 *
 * A signed-out visitor gets `200` with `{ signedIn: false }`, not a 401. This
 * is a question, and "no" is a valid answer — a 401 here would fill the console
 * with red on the one page most likely to be someone's first impression.
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ signedIn: false });
  }

  // Fire-and-forget by design: if the slide fails, the person keeps the window
  // they already had and this response is still correct.
  await renewSession(session);

  return NextResponse.json({
    signedIn: true,
    role: session.role,
    /** So a caller never has to re-derive which dashboard this role belongs to. */
    dashboard: dashboardFor(session.role),
  });
}
