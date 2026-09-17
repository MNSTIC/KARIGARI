import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { computeCreditProfile, MIN_EVENTS_FOR_SCORE, CREDIT_ALGO_VERSION } from '@/lib/creditScore';
import { gatherCreditInputs, listActiveShares } from '@/lib/creditRecord';
import {
  MAX_ACTIVE_SHARES,
  SHARE_DAY_OPTIONS,
  SHARE_DEFAULT_DAYS,
  SHARE_MAX_DAYS,
  cleanSharedWith,
  creditSharePath,
  newShareToken,
  parseShareDays,
} from '@/lib/creditShare';
import { publicOrigin } from '@/lib/publicOrigin';

export const dynamic = 'force-dynamic';

/**
 * The signed-in artisan's production record and their bank share links.
 *
 *   GET    — the live profile, computed now, plus the links still active
 *   POST   — freeze today's profile into a new share link
 *   DELETE — revoke one link (?id=)
 *
 * A production record, not a credit rating: Karigari does not lend and does not
 * decide loans. The profile is computed by the pure src/lib/creditScore.ts from
 * counts gathered in src/lib/creditRecord.ts.
 */

const limits = {
  maxActiveShares: MAX_ACTIVE_SHARES,
  defaultDays: SHARE_DEFAULT_DAYS,
  maxDays: SHARE_MAX_DAYS,
  dayOptions: SHARE_DAY_OPTIONS,
};

export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const now = new Date();
    const [inputs, shares] = await Promise.all([
      gatherCreditInputs(artisanId, now),
      listActiveShares(artisanId, publicOrigin(req), now),
    ]);
    return NextResponse.json({
      success: true,
      profile: computeCreditProfile(inputs, now),
      shares,
      limits,
    });
  } catch (error) {
    console.error('Credit profile error:', error);
    return NextResponse.json({ error: 'Could not load your production record.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const days = parseShareDays(body?.expiresInDays);
  if (days === null) {
    return NextResponse.json(
      { error: `A link can last 1 to ${SHARE_MAX_DAYS} days.`, code: 'BAD_DAYS' },
      { status: 400 }
    );
  }
  const sharedWith = cleanSharedWith(body?.sharedWith);

  try {
    const now = new Date();
    const active = await prisma.creditProfileShare.count({
      where: { artisanId, revokedAt: null, expiresAt: { gt: now } },
    });
    if (active >= MAX_ACTIVE_SHARES) {
      return NextResponse.json(
        {
          error: `You already have ${MAX_ACTIVE_SHARES} active links. Revoke one to make another.`,
          code: 'SHARE_LIMIT',
          max: MAX_ACTIVE_SHARES,
        },
        { status: 409 }
      );
    }

    const profile = computeCreditProfile(await gatherCreditInputs(artisanId, now), now);
    if (!profile.eligible) {
      return NextResponse.json(
        {
          error: `A record can be shared once it has ${MIN_EVENTS_FOR_SCORE} recorded events.`,
          code: 'NOT_ELIGIBLE',
          eventCount: profile.eventCount,
          min: MIN_EVENTS_FOR_SCORE,
        },
        { status: 409 }
      );
    }

    const expiresAt = new Date(now.getTime() + days * 86_400_000);
    const snapshot = profile as unknown as Prisma.InputJsonValue;

    // The token is the unique column. A collision between two 244-bit random
    // values will not happen, but if it ever did the create is simply retried
    // with a fresh token rather than surfacing a 500.
    let share = null;
    for (let attempt = 0; attempt < 2 && !share; attempt += 1) {
      try {
        share = await prisma.creditProfileShare.create({
          data: {
            artisanId,
            token: newShareToken(),
            snapshot,
            version: CREDIT_ALGO_VERSION,
            sharedWith,
            expiresAt,
          },
          select: {
            id: true,
            token: true,
            sharedWith: true,
            viewCount: true,
            lastViewedAt: true,
            expiresAt: true,
            createdAt: true,
          },
        });
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!retryable || attempt === 1) throw error;
      }
    }
    if (!share) throw new Error('share not created');

    return NextResponse.json(
      {
        success: true,
        share: {
          id: share.id,
          url: `${publicOrigin(req)}${creditSharePath(share.token)}`,
          sharedWith: share.sharedWith,
          viewCount: share.viewCount,
          lastViewedAt: null,
          expiresAt: share.expiresAt.toISOString(),
          createdAt: share.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Credit share create error:', error);
    return NextResponse.json({ error: 'Could not create the link.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Which link?', code: 'NOT_FOUND' }, { status: 400 });

  try {
    // Scoped to this artisan and to links not already revoked, so one artisan
    // can never revoke another's link and a double tap changes nothing twice.
    const revoked = await prisma.creditProfileShare.updateMany({
      where: { id, artisanId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      return NextResponse.json({ error: 'Link not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Credit share revoke error:', error);
    return NextResponse.json({ error: 'Could not revoke the link.' }, { status: 500 });
  }
}
