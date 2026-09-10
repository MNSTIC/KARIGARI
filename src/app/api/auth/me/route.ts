import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/authSession';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';

/**
 * Who is signed in.
 *
 * `userId` and `role` come straight from the verified token, as they always
 * have. V10 adds `authProvider`, which needs a row read: the profile editor has
 * to know whether to offer passkeys at all, and offering them to a PASSWORD
 * account would render a section the API can only answer with a 403.
 *
 * Deliberately nothing else. This route is called from client components on
 * several pages, and every extra field would be one more thing shipped to the
 * browser on every check.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { authProvider: true },
    });

    return NextResponse.json({
      success: true,
      userId: session.userId,
      role: session.role,
      // Null when the row has gone missing under a still-valid token. Callers
      // treat that the same as PASSWORD: offer nothing.
      authProvider: user?.authProvider ?? null,
    });
  } catch (error) {
    console.error('[auth/me] failed:', error);
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
