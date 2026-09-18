import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { classifyDistance, hammingDistance, normaliseHash } from '@/lib/motifHash';
import { cleanMotifName, normaliseDescriptors, type DescriptorSource } from '@/lib/motifLicence';
import { clusterKeyFor } from '@/lib/motifRecord';

/**
 * POST /api/motif/register — file a motif fingerprint for the artisan's cluster.
 *
 * The fingerprint arrives already computed, from the browser. That is
 * deliberate: decoding several full-size data-URL images server-side would
 * exhaust memory on this deployment, and the server has no need for the pixels.
 * It validates the FORMAT and stores the value, which is acceptable because a
 * fingerprint here is a discovery aid a human reviews — nothing is authorised
 * because two hashes matched.
 *
 * What happens to a near match matters more than the match itself:
 *
 *   - **Same cluster** → refused politely as already registered, pointing at the
 *     existing record. Not a second row, not an error.
 *   - **Another cluster** → `FLAGGED_DUPLICATE` with the distance, for a human
 *     to look at. Neither cluster is told the other took anything: two villages
 *     can carry the same tradition, and this app does not get to adjudicate
 *     that.
 *   - **Otherwise** → `PENDING`, because an admin confirms a registration.
 *
 * Nothing written here is a Geographical Indication or a legal right. See
 * src/components/MotifDisclaimer.tsx, rendered on every motif surface.
 */
export const dynamic = 'force-dynamic';

const MAX_REFERENCE_BYTES = 400 * 1024;
/** How many registrations one artisan may file. A register, not a land grab. */
const MAX_PER_ARTISAN = 40;

function fail(status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, code, error, ...extra }, { status });
}

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const hash = normaliseHash(body.hash);
    if (!hash) {
      return fail(400, 'BAD_HASH', 'The fingerprint could not be read. Try the photo again.');
    }

    const name = cleanMotifName(body.name);
    if (!name) {
      return fail(400, 'BAD_NAME', 'Give the motif a name your cluster would recognise.');
    }

    const clusterKey = await clusterKeyFor(artisanId);
    if (!clusterKey) {
      return fail(409, 'NO_CLUSTER', 'Add your village or SHG to your profile before registering a motif.');
    }

    const held = await prisma.motifRegistration.count({ where: { submittedById: artisanId } });
    if (held >= MAX_PER_ARTISAN) {
      return fail(409, 'TOO_MANY', 'You have filed the maximum number of motif records.');
    }

    // The reference crop is optional, but a huge one is refused rather than
    // truncated: half an image is not a crop anybody can review.
    const reference = typeof body.referenceImageUrl === 'string' ? body.referenceImageUrl : '';
    if (reference && reference.length > MAX_REFERENCE_BYTES) {
      return fail(413, 'IMAGE_TOO_LARGE', 'That reference image is too large. Use the suggested crop.');
    }

    const source: DescriptorSource = body.descriptorSource === 'AI' ? 'AI' : 'HEURISTIC';
    const descriptors = normaliseDescriptors(body.descriptors, source);

    // Only the columns the comparison needs. Loading reference images here would
    // pull megabytes for a distance calculation that needs 16 characters.
    const existing = await prisma.motifRegistration.findMany({
      where: { status: { in: ['PENDING', 'REGISTERED', 'FLAGGED_DUPLICATE'] } },
      select: { id: true, hash: true, clusterKey: true, name: true, status: true },
    });

    let nearestSame: { id: string; name: string; distance: number } | null = null;
    let nearestOther: { id: string; distance: number } | null = null;

    for (const row of existing) {
      let distance: number;
      try {
        distance = hammingDistance(hash, row.hash);
      } catch {
        // A malformed legacy row is skipped, never allowed to block a filing.
        continue;
      }
      if (classifyDistance(distance) !== 'DUPLICATE') continue;

      if (row.clusterKey === clusterKey) {
        if (!nearestSame || distance < nearestSame.distance) {
          nearestSame = { id: row.id, name: row.name, distance };
        }
      } else if (!nearestOther || distance < nearestOther.distance) {
        nearestOther = { id: row.id, distance };
      }
    }

    // Already the cluster's own: point at it rather than making a second row.
    if (nearestSame) {
      return fail(409, 'ALREADY_REGISTERED', 'Your cluster has already registered this motif.', {
        existingId: nearestSame.id,
        existingName: nearestSame.name,
        distance: nearestSame.distance,
      });
    }

    const flagged = Boolean(nearestOther);
    const row = await prisma.motifRegistration.create({
      data: {
        clusterKey,
        submittedById: artisanId,
        craftItemId: typeof body.craftItemId === 'string' && body.craftItemId ? body.craftItemId : null,
        name,
        hash,
        descriptors: { ...descriptors } as unknown as Prisma.InputJsonObject,
        referenceImageUrl: reference || null,
        status: flagged ? 'FLAGGED_DUPLICATE' : 'PENDING',
        duplicateOfId: nearestOther?.id ?? null,
        duplicateDistance: nearestOther?.distance ?? null,
      },
      select: { id: true, status: true, hash: true, duplicateDistance: true, registeredAt: true },
    });

    return NextResponse.json(
      {
        success: true,
        motif: {
          id: row.id,
          status: row.status,
          hash: row.hash,
          duplicateDistance: row.duplicateDistance,
          registeredAt: row.registeredAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[motif/register] failed:', error);
    return fail(500, 'REGISTER_FAILED', 'Could not file that motif. Try again.');
  }
}
