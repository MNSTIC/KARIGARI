import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { RAZORPAYX_ENABLED, payoutToVpa } from '@/lib/razorpayPayout';
import { LOT_THRESHOLD_GRAMS, normaliseMaterial, splitProRata, type ScrapMaterial } from '@/lib/scrap';
import { clusterAreaLabel, scrapSoldTitle } from '@/lib/scrapRecord';
import { notifyCluster } from '@/lib/motifRecord';

/**
 * The facilitator records a scrap sale that actually happened.
 *
 * This is the only place in the feature where a rupee figure is written, and it
 * is written from a number a human typed after a real recycler really paid. No
 * estimate, no suggestion, no market rate — this project has no feed for any of
 * those and inventing one would put a figure in an artisan's ledger that nobody
 * ever earned.
 *
 * Three rules, the same three the motif payout holds:
 *
 *   1. **Nothing is distributed that was not sold.** The pool must be LISTED
 *      with `soldAt` still null, and the guard is the update predicate, so a
 *      second click is a no-op rather than a second distribution.
 *   2. **No rupee rounds away.** `splitProRata` distributes the remainder one
 *      rupee at a time to the largest contributors and throws if the shares do
 *      not sum to exactly the sale price — before anything is written, because
 *      a caller that has already marked a pool SOLD cannot recover from a bad
 *      split.
 *   3. **A recorded payout is never described as a bank transfer.** RazorpayX
 *      is not configured on this deployment, so `payoutToVpa` returns SIMULATED
 *      and that word rides on every share row and every screen.
 */
export const dynamic = 'force-dynamic';

const MAX_NAME = 120;
const MAX_CONTACT = 120;
/** A sale figure, bounded so a slipped key cannot write a fortune to a ledger. */
const MAX_SALE_RUPEES = 10_000_000;

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

async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; response: NextResponse }> {
  const token = (await cookies()).get('auth-token');
  if (!token) return { ok: false, response: fail(401, 'UNAUTHORIZED', 'Sign in first.') };
  try {
    const decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret') as {
      userId: string;
      role: string;
    };
    if (decoded.role !== 'ADMIN') return { ok: false, response: fail(403, 'FORBIDDEN', 'Admin access required.') };
    return { ok: true, adminId: decoded.userId };
  } catch {
    return { ok: false, response: fail(401, 'BAD_TOKEN', 'Your session is no longer valid.') };
  }
}

// ---------------------------------------------------------------------- GET

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const pools = await prisma.scrapPool.findMany({
      where: { status: { in: ['LISTED', 'SOLD'] } },
      orderBy: [{ status: 'asc' }, { listedAt: 'desc' }],
      take: 40,
      select: {
        id: true,
        clusterKey: true,
        material: true,
        totalGrams: true,
        contributorCount: true,
        status: true,
        listedAt: true,
        soldAt: true,
        salePriceRupees: true,
        recyclerName: true,
        enquiries: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            recyclerName: true,
            contact: true,
            offerRupees: true,
            message: true,
            createdAt: true,
          },
        },
        _count: { select: { enquiries: true, shares: true } },
      },
    });

    const areas = new Map<string, string | null>();
    for (const key of new Set(pools.map((pool) => pool.clusterKey))) {
      areas.set(key, await clusterAreaLabel(key));
    }

    return NextResponse.json({
      success: true,
      openCount: pools.filter((pool) => pool.status === 'LISTED').length,
      razorpayxConfigured: RAZORPAYX_ENABLED,
      pools: pools.map((pool) => {
        const material = normaliseMaterial(pool.material) as ScrapMaterial;
        return {
          id: pool.id,
          material,
          area: areas.get(pool.clusterKey) ?? null,
          totalGrams: pool.totalGrams,
          thresholdGrams: LOT_THRESHOLD_GRAMS[material],
          contributorCount: pool.contributorCount,
          status: pool.status,
          listedAt: pool.listedAt?.toISOString() ?? null,
          soldAt: pool.soldAt?.toISOString() ?? null,
          salePriceRupees: pool.salePriceRupees,
          recyclerName: pool.recyclerName,
          enquiryCount: pool._count.enquiries,
          shareCount: pool._count.shares,
          enquiries: pool.enquiries.map((enquiry) => ({
            id: enquiry.id,
            recyclerName: enquiry.recyclerName,
            contact: enquiry.contact,
            offerRupees: enquiry.offerRupees,
            message: enquiry.message,
            createdAt: enquiry.createdAt.toISOString(),
          })),
        };
      }),
    });
  } catch (error) {
    console.error('[admin/scrap-sale] read failed:', error);
    return fail(500, 'READ_FAILED', 'Could not load the scrap pools.');
  }
}

// --------------------------------------------------------------------- POST

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const poolId = typeof body.poolId === 'string' ? body.poolId : '';
    const recyclerName = text(body.recyclerName, MAX_NAME);
    const recyclerContact = text(body.recyclerContact, MAX_CONTACT);
    const price = Number(body.salePriceRupees);

    if (!poolId) return fail(400, 'BAD_REQUEST', 'Say which pool was sold.');
    if (!recyclerName || !recyclerContact) {
      return fail(400, 'NO_BUYER', 'Record who bought the lot and how to reach them.');
    }
    if (!Number.isInteger(price) || price <= 0 || price > MAX_SALE_RUPEES) {
      return fail(400, 'BAD_PRICE', 'Enter the whole rupee figure the recycler actually paid.');
    }

    const pool = await prisma.scrapPool.findUnique({
      where: { id: poolId },
      select: { id: true, clusterKey: true, material: true, status: true, soldAt: true, totalGrams: true },
    });
    if (!pool) return fail(404, 'NOT_FOUND', 'That pool no longer exists.');
    if (pool.soldAt) return fail(409, 'ALREADY_SOLD', 'This pool has already been sold and distributed.');
    if (pool.status !== 'LISTED') {
      return fail(409, 'NOT_LISTED', 'Only a pool that reached its minimum weight and listed can be sold.');
    }

    // Who is in the pool, with the weight each of them actually logged and the
    // moment they first logged it — the tie-break `splitProRata` needs.
    const lots = await prisma.scrapLot.findMany({
      where: { pooledLotId: pool.id, status: { in: ['LOGGED', 'POOLED'] } },
      select: { artisanId: true, grams: true, loggedAt: true },
    });
    if (lots.length === 0) return fail(409, 'EMPTY_POOL', 'There is no scrap left in this pool to distribute.');

    const byArtisan = new Map<string, { artisanId: string; grams: number; at: Date }>();
    for (const lot of lots) {
      const seen = byArtisan.get(lot.artisanId);
      if (seen) {
        seen.grams += lot.grams;
        if (lot.loggedAt < seen.at) seen.at = lot.loggedAt;
      } else {
        byArtisan.set(lot.artisanId, { artisanId: lot.artisanId, grams: lot.grams, at: lot.loggedAt });
      }
    }
    const contributions = [...byArtisan.values()];

    // Throws before anything is written if the arithmetic would not add up.
    const shares = splitProRata(price, contributions);

    // Each artisan's own VPA, read from the database and never from a body.
    const artisanIds = shares.map((share) => share.artisanId);
    const [profiles, names] = await Promise.all([
      prisma.artisanProfile.findMany({
        where: { userId: { in: artisanIds } },
        select: { userId: true, upiId: true },
      }),
      prisma.user.findMany({ where: { id: { in: artisanIds } }, select: { id: true, name: true } }),
    ]);
    const vpaFor = new Map(profiles.map((row) => [row.userId, row.upiId ?? '']));
    const nameFor = new Map(names.map((row) => [row.id, row.name]));

    const material = normaliseMaterial(pool.material);

    // Payouts first, outside the transaction: a network call inside one would
    // hold a database lock open for the length of an HTTP round trip. On this
    // deployment every one of these returns SIMULATED without leaving the process.
    const settled: Array<{ artisanId: string; grams: number; amount: number; mode: string; reference: string }> = [];
    for (const share of shares) {
      const result = await payoutToVpa({
        amount: share.amount,
        vpa: vpaFor.get(share.artisanId) || 'unconfigured@upi',
        referenceId: `${pool.id}-${share.artisanId}`,
        contactName: nameFor.get(share.artisanId) ?? 'Artisan',
        notes: { scrap: material, cluster: pool.clusterKey },
      });
      settled.push({
        artisanId: share.artisanId,
        grams: share.grams,
        amount: share.amount,
        mode: result.mode,
        reference: result.reference,
      });
    }

    const mode = settled.every((row) => row.mode === 'RAZORPAYX') ? 'RAZORPAYX' : 'SIMULATED';
    const now = new Date();

    const written = await prisma.$transaction(async (tx) => {
      // The guard is the predicate: a second click finds `soldAt` already set
      // and writes nothing.
      const claimed = await tx.scrapPool.updateMany({
        where: { id: pool.id, soldAt: null, status: 'LISTED' },
        data: {
          status: 'SOLD',
          soldAt: now,
          salePriceRupees: price,
          recyclerName,
          recyclerContact,
          // Out of the live unique key, so the cluster can start its next pool
          // of this material straight away.
          liveKey: null,
        },
      });
      if (claimed.count === 0) return 0;

      await tx.scrapPayoutShare.createMany({
        data: settled.map((row) => ({
          poolId: pool.id,
          artisanId: row.artisanId,
          grams: row.grams,
          amount: row.amount,
          payoutMode: row.mode,
          payoutRef: row.reference,
        })),
      });

      await tx.scrapLot.updateMany({
        where: { pooledLotId: pool.id, status: { in: ['LOGGED', 'POOLED'] } },
        data: { status: 'SOLD' },
      });
      return claimed.count;
    });

    if (written === 0) return fail(409, 'ALREADY_SOLD', 'This pool has already been sold and distributed.');

    const total = settled.reduce((sum, row) => sum + row.amount, 0);
    await notifyCluster(
      artisanIds,
      scrapSoldTitle(material),
      mode === 'RAZORPAYX'
        ? 'Your cluster sold its pooled scrap. Your share, worked out from the weight you logged, has been sent to your UPI.'
        : 'Your cluster sold its pooled scrap. Your share, worked out from the weight you logged, is recorded to your scrap ledger. Karigari has not moved this money — the payout rail is not live on this deployment.'
    ).catch((error) => console.warn('[scrap sale] notify failed:', (error as Error)?.message));

    console.info(
      `[scrap] pool ${pool.id} (${pool.clusterKey} / ${material}) sold for ₹${price} across ${settled.length} contributors, mode ${mode}`
    );

    return NextResponse.json({
      success: true,
      poolId: pool.id,
      material,
      salePriceRupees: price,
      payoutMode: mode,
      razorpayxConfigured: RAZORPAYX_ENABLED,
      total,
      shares: settled,
    });
  } catch (error) {
    console.error('[admin/scrap-sale] failed:', error);
    return fail(500, 'SALE_FAILED', (error as Error)?.message || 'Could not record that sale.');
  }
}
