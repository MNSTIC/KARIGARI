import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { clusterDisplayName, toPublicMotif } from '@/lib/motifLicence';
import { clusterKeyFor, readTrustLedger } from '@/lib/motifRecord';

/**
 * GET /api/artisan/motifs — the artisan's own view of their cluster's register.
 *
 * Three things in one request, because they are one screen: the pieces they
 * could register a motif from, every registration the CLUSTER holds (not just
 * their own — the register belongs to the village), and the trust ledger of what
 * licence money has actually arrived.
 *
 * The pieces carry a thumbnail URL rather than the photo itself. A base64
 * capture is a few hundred kilobytes and ten of them is the multi-megabyte
 * payload the dashboard route already exists to avoid; the browser fetches the
 * one it needs when the artisan picks it.
 */
export const dynamic = 'force-dynamic';

const MAX_PIECES = 24;

/** The same convention `/api/artisan/dashboard` uses for list thumbnails. */
function thumbnailFor(id: string, images: string[] | null | undefined): string | null {
  const first = images?.[0];
  if (!first) return null;
  return first.startsWith('data:') ? `/api/items/${id}/thumbnail` : first;
}

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const clusterKey = await clusterKeyFor(artisanId);

    const [pieces, registrations, ledger] = await Promise.all([
      prisma.craftItem.findMany({
        where: { artisanId },
        orderBy: { createdAt: 'desc' },
        take: MAX_PIECES,
        select: { id: true, craftType: true, images: true, patchId: true, createdAt: true },
      }),
      clusterKey
        ? prisma.motifRegistration.findMany({
            where: { clusterKey },
            orderBy: { registeredAt: 'desc' },
            take: 50,
            select: {
              id: true,
              name: true,
              hash: true,
              clusterKey: true,
              descriptors: true,
              referenceImageUrl: true,
              status: true,
              licensable: true,
              registeredAt: true,
              duplicateDistance: true,
              adminNote: true,
              submittedById: true,
              submittedBy: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      clusterKey ? readTrustLedger(artisanId, clusterKey) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      clusterKey,
      clusterName: clusterKey ? clusterDisplayName(clusterKey) : null,
      pieces: pieces.map((piece) => ({
        id: piece.id,
        craftType: piece.craftType,
        patchId: piece.patchId,
        thumbnail: thumbnailFor(piece.id, piece.images),
        createdAt: piece.createdAt.toISOString(),
      })),
      motifs: registrations.map((row) => ({
        ...toPublicMotif(row),
        /** Only shown to the cluster, so a flagged record can explain itself. */
        duplicateDistance: row.duplicateDistance,
        adminNote: row.adminNote,
        mine: row.submittedById === artisanId,
      })),
      ledger,
    });
  } catch (error) {
    console.error('[artisan/motifs] failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load your motif register.' }, { status: 500 });
  }
}
