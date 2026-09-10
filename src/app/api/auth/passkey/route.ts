import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/authSession';

export const dynamic = 'force-dynamic';

/**
 * List and revoke the signed-in user's own passkeys.
 *
 * Both handlers scope by `userId` inside the query predicate rather than
 * fetching and then checking, so there is no window in which a mismatched id
 * could still read or delete somebody else's credential.
 *
 * `publicKey` and `credentialId` are deliberately never returned. The list
 * exists so a person can tell which authenticator to revoke, and a label plus
 * two dates answers that; the credential material answers nothing and would be
 * one more thing to leak.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const passkeys = await prisma.passkey.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      passkeys: passkeys.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error('[passkey] list failed:', error);
    return NextResponse.json({ error: 'Could not load your passkeys.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { authProvider: true },
    });
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Removing the last passkey from a PASSKEY-provider account locks it out
    // permanently: there is no password on the row, and this app has no email
    // recovery. Refusing is the only honest option — the alternative is a
    // person cheerfully deleting their own only way in.
    if (user.authProvider === 'PASSKEY') {
      const remaining = await prisma.passkey.count({ where: { userId: session.userId } });
      if (remaining <= 1) {
        return NextResponse.json(
          {
            error:
              'This is the only way you can sign in. Add another passkey before removing this one.',
          },
          { status: 409 }
        );
      }
    }

    // Scoped in the predicate: a passkey belonging to somebody else simply
    // matches nothing, and the count tells us so without a separate read.
    const result = await prisma.passkey.deleteMany({
      where: { id, userId: session.userId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: 'Passkey not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[passkey] delete failed:', error);
    return NextResponse.json({ error: 'Could not remove that passkey.' }, { status: 500 });
  }
}
