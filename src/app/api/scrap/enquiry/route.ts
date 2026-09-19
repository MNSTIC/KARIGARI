import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saltedIpHash } from '@/lib/searchLog';
import { ENQUIRY_RATE_LIMIT, ENQUIRY_RATE_WINDOW_MS, normaliseMaterial } from '@/lib/scrap';
import { notifyCluster } from '@/lib/motifRecord';
import { poolContributorIds, scrapEnquiryTitle } from '@/lib/scrapRecord';

/**
 * POST /api/scrap/enquiry — a recycler asks about a listed lot.
 *
 * Public and unauthenticated, like the board it reads from.
 *
 * Nothing is agreed here. An offer figure is optional and, when given, is
 * stored as what the recycler said — it never becomes the pool's price and it
 * is never shown as one. Only an admin recording a completed sale writes a
 * rupee figure to a pool, and only then does any money arithmetic run.
 *
 * Rate-limited on the salted address digest `MarketplaceSearch` already stores.
 * The only question it answers is "was this the same visitor", which is what a
 * rate limit needs and nothing more.
 */
export const dynamic = 'force-dynamic';

const MAX_NAME = 80;
const MAX_CONTACT = 120;
const MAX_MESSAGE = 400;
/** A recycler's stated offer, bounded so a typo cannot store a lakh-crore. */
const MAX_OFFER = 10_000_000;

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const kept = [...value].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 32) return false;
    if (cp >= 127 && cp < 160) return false;
    if (cp >= 0x202a && cp <= 0x202e) return false;
    if (cp >= 0x2066 && cp <= 0x2069) return false;
    return true;
  });
  return kept.join('').replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const poolId = typeof body.poolId === 'string' ? body.poolId : '';
    const recyclerName = text(body.recyclerName, MAX_NAME);
    const contact = text(body.contact, MAX_CONTACT);
    const message = text(body.message, MAX_MESSAGE);

    const rawOffer = Number(body.offerRupees);
    const offerRupees =
      Number.isInteger(rawOffer) && rawOffer > 0 && rawOffer <= MAX_OFFER ? rawOffer : null;

    if (!poolId || !recyclerName || !contact) {
      return fail(400, 'INCOMPLETE', 'Tell us who you are and how the cluster can reach you.');
    }

    const pool = await prisma.scrapPool.findUnique({
      where: { id: poolId },
      select: { id: true, material: true, status: true, totalGrams: true },
    });
    // An OPEN pool is not on the board and a SOLD one is gone from it, so an
    // enquiry against either is refused rather than quietly queued.
    if (!pool || pool.status !== 'LISTED') {
      return fail(404, 'NOT_LISTED', 'That lot is not open for enquiries.');
    }

    const ipHash = saltedIpHash(req);
    if (ipHash) {
      const since = new Date(Date.now() - ENQUIRY_RATE_WINDOW_MS);
      const recent = await prisma.scrapEnquiry.count({ where: { ipHash, createdAt: { gte: since } } });
      if (recent >= ENQUIRY_RATE_LIMIT) {
        return fail(429, 'RATE_LIMITED', 'Too many enquiries from here in the last hour. Try again later.');
      }
    }

    const enquiry = await prisma.scrapEnquiry.create({
      data: { poolId: pool.id, recyclerName, contact, offerRupees, message: message || null, ipHash },
      select: { id: true, status: true, createdAt: true },
    });

    const material = normaliseMaterial(pool.material);
    const contributors = await poolContributorIds(pool.id);
    await notifyCluster(
      contributors,
      scrapEnquiryTitle(material),
      `${recyclerName} has asked about your cluster's pooled ${material
        .toLowerCase()
        .replace(/_/g, ' ')}. Nothing is agreed and no price is set — open Workshop → Scrap & waste to see the enquiry.`
    ).catch((error) => console.warn('[scrap/enquiry] notify failed:', (error as Error)?.message));

    return NextResponse.json(
      {
        success: true,
        enquiry: {
          id: enquiry.id,
          status: enquiry.status,
          createdAt: enquiry.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[scrap/enquiry] failed:', error);
    return fail(500, 'ENQUIRY_FAILED', 'Could not send that enquiry. Try again.');
  }
}
