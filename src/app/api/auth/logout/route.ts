import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/authSession';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Sign out. Clearing the cookie IS the whole of it — `auth-token` is httpOnly,
 * so the server is the only thing that can remove it.
 *
 * Goes through `clearSession()` so the cookie name and path live in one place
 * alongside the code that sets them; a logout that cleared a differently-scoped
 * cookie would leave the session alive.
 */
export async function POST() {
  await clearSession();
  return NextResponse.json({ success: true });
}
