import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';

/**
 * Members of THIS artisan's cluster, plus any open resource requests inside it.
 *
 * CLUSTER DEFINITION. The rule is deliberately explicit here rather than
 * derived from the row's `clusterName` text, which is free-form and drifts:
 *
 *   - if the caller has an `shgGroupLink`, the cluster is everyone else who
 *     shares the same link (across every location);
 *   - otherwise it is everyone else at the same `location` who also has no SHG
 *     link — an "auto cluster" of independent artisans in the same town.
 *
 * The `clusterName` used to key resource requests is either the SHG link or
 * `auto:<location>`, so the two branches share one bucket and the same rows
 * cannot leak between them.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;

  try {
    const profile = await prisma.artisanProfile.findUnique({
      where: { userId: auth.artisan.userId },
      select: {
        userId: true,
        location: true,
        shgGroupLink: true,
        clusterName: true,
      },
    });

    if (!profile) {
      return NextResponse.json({ error: 'Artisan profile not found.' }, { status: 404 });
    }

    const shg = profile.shgGroupLink?.trim() || null;
    const location = profile.location?.trim() || null;

    // The cluster key resource requests are scoped by. Same string on both
    // sides of the "am I in this cluster?" test, so the write and the read
    // agree.
    const clusterKey = shg ? shg : location ? `auto:${location.toLowerCase()}` : null;

    if (!clusterKey) {
      return NextResponse.json({
        success: true,
        cluster: null,
        members: [],
        requests: [],
      });
    }

    const memberWhere = shg
      ? { shgGroupLink: shg, NOT: { userId: auth.artisan.userId } }
      : {
          shgGroupLink: null,
          location: profile.location,
          NOT: { userId: auth.artisan.userId },
        };

    const members = await prisma.artisanProfile.findMany({
      where: memberWhere,
      select: {
        userId: true,
        craftType: true,
        location: true,
        clusterName: true,
        experienceYears: true,
        photoUrl: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { user: { name: 'asc' } },
      take: 60,
    });

    const requests = await prisma.resourceRequest.findMany({
      where: { clusterName: clusterKey, status: { in: ['OPEN', 'ACCEPTED'] } },
      include: {
        requester: { select: { id: true, name: true } },
        acceptedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    return NextResponse.json({
      success: true,
      cluster: {
        // Exposed so the UI can title the section "SHG Group Members" vs
        // "Artisans Near You" without re-deriving the rule.
        kind: shg ? 'shg' : 'auto',
        key: clusterKey,
        shgGroupLink: shg,
        location,
      },
      members: members.map((member) => ({
        userId: member.userId,
        name: member.user.name,
        craftType: member.craftType,
        location: member.location,
        clusterName: member.clusterName,
        experienceYears: member.experienceYears,
        photoUrl: member.photoUrl,
      })),
      requests: requests.map((request) => ({
        id: request.id,
        resourceName: request.resourceName,
        description: request.description,
        quantity: request.quantity,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
        requester: { id: request.requester.id, name: request.requester.name },
        acceptedBy: request.acceptedBy
          ? { id: request.acceptedBy.id, name: request.acceptedBy.name }
          : null,
        isMine: request.requesterId === auth.artisan.userId,
      })),
    });
  } catch (error) {
    console.error('Cluster members error:', error);
    return NextResponse.json({ error: 'Failed to load cluster.' }, { status: 500 });
  }
}
