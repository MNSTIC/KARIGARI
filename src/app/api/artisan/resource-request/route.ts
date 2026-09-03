import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';

/**
 * Post, accept and close resource requests inside one cluster.
 *
 *   POST    — the caller creates a new OPEN request in THEIR cluster
 *   PATCH   — another cluster member accepts an OPEN request
 *   PUT     — the requester marks their own request FULFILLED
 *
 * The cluster key is always re-derived from the caller's profile, so a request
 * cannot be posted or accepted into someone else's cluster by pushing a
 * different `clusterName` in the body.
 */
export const dynamic = 'force-dynamic';

async function resolveClusterKey(userId: string) {
  const profile = await prisma.artisanProfile.findUnique({
    where: { userId },
    select: { shgGroupLink: true, location: true },
  });
  if (!profile) return null;
  const shg = profile.shgGroupLink?.trim() || null;
  const location = profile.location?.trim() || null;
  return shg ? shg : location ? `auto:${location.toLowerCase()}` : null;
}

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      resourceName?: unknown;
      description?: unknown;
      quantity?: unknown;
    };
    const resourceName = trimmed(body.resourceName, 120);
    const description = trimmed(body.description, 500) || null;
    const quantity = trimmed(body.quantity, 60) || null;

    if (!resourceName) {
      return NextResponse.json({ error: 'resourceName is required.' }, { status: 400 });
    }

    const clusterKey = await resolveClusterKey(auth.artisan.userId);
    if (!clusterKey) {
      return NextResponse.json(
        { error: 'Set a cluster or location on your profile before posting a request.' },
        { status: 409 }
      );
    }

    const request = await prisma.resourceRequest.create({
      data: {
        requesterId: auth.artisan.userId,
        resourceName,
        description,
        quantity,
        clusterName: clusterKey,
      },
    });

    return NextResponse.json({ success: true, request });
  } catch (error) {
    console.error('Resource request POST error:', error);
    return NextResponse.json({ error: 'Failed to post request.' }, { status: 500 });
  }
}

/** Accept an OPEN request. Requester cannot accept their own. */
export async function PATCH(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as { requestId?: unknown };
    const requestId = trimmed(body.requestId, 64);
    if (!requestId) {
      return NextResponse.json({ error: 'requestId is required.' }, { status: 400 });
    }

    const request = await prisma.resourceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, clusterName: true, requesterId: true },
    });
    if (!request) {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    }
    if (request.status !== 'OPEN') {
      return NextResponse.json(
        { error: 'This request is no longer open.' },
        { status: 409 }
      );
    }
    if (request.requesterId === auth.artisan.userId) {
      return NextResponse.json(
        { error: 'You cannot accept your own request.' },
        { status: 409 }
      );
    }

    // Same-cluster check: the accepter's cluster must match the request's key.
    const clusterKey = await resolveClusterKey(auth.artisan.userId);
    if (clusterKey !== request.clusterName) {
      return NextResponse.json(
        { error: 'This request belongs to a different cluster.' },
        { status: 403 }
      );
    }

    const updated = await prisma.resourceRequest.update({
      where: { id: requestId },
      data: {
        status: 'ACCEPTED',
        acceptedById: auth.artisan.userId,
        acceptedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    console.error('Resource request PATCH error:', error);
    return NextResponse.json({ error: 'Failed to accept request.' }, { status: 500 });
  }
}

/** Mark FULFILLED — only the original requester may do this. */
export async function PUT(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as { requestId?: unknown };
    const requestId = trimmed(body.requestId, 64);
    if (!requestId) {
      return NextResponse.json({ error: 'requestId is required.' }, { status: 400 });
    }

    const request = await prisma.resourceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, requesterId: true, status: true },
    });
    if (!request) {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    }
    if (request.requesterId !== auth.artisan.userId) {
      return NextResponse.json(
        { error: 'Only the requester can mark this fulfilled.' },
        { status: 403 }
      );
    }
    if (request.status === 'FULFILLED' || request.status === 'CANCELLED') {
      return NextResponse.json({ success: true, idempotent: true });
    }

    const updated = await prisma.resourceRequest.update({
      where: { id: requestId },
      data: { status: 'FULFILLED' },
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    console.error('Resource request PUT error:', error);
    return NextResponse.json({ error: 'Failed to update request.' }, { status: 500 });
  }
}
