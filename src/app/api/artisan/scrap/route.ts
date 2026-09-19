import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { clusterKeyFor, notifyCluster } from '@/lib/motifRecord';
import {
  LOT_THRESHOLD_GRAMS,
  MAX_LOT_GRAMS,
  MAX_SCRAP_PHOTO_BYTES,
  MIN_LOT_GRAMS,
  normaliseMaterial,
  sharePercent,
  type ScrapMaterial,
} from '@/lib/scrap';
import {
  clusterAreaLabel,
  findOrCreateLivePool,
  lockPoolLane,
  poolContributorIds,
  readScrapEarnings,
  recomputePool,
  scrapDemotedTitle,
  scrapListedTitle,
} from '@/lib/scrapRecord';

/**
 * The artisan's half of Scrap-to-Wealth: log a lot, read the cluster's pools,
 * withdraw a lot.
 *
 * What this route is careful about:
 *
 *   · **Weight is self-reported and says so.** Nobody here weighs anything, so
 *     every figure that leaves this route is the artisan's own number and every
 *     screen that renders it calls it that.
 *   · **Listing is arithmetic.** A pool crosses its threshold and lists; a
 *     withdrawal drops it back under and it stops being listed. Neither is a
 *     decision anybody makes, and both are logged.
 *   · **Totals are recomputed, never incremented.** See `recomputePool`.
 *   · **No price, ever.** This route returns weights, counts and percentages.
 *     A rupee figure appears only after an admin records what a recycler
 *     actually paid.
 */
export const dynamic = 'force-dynamic';

const MAX_NOTES = 300;

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

/** Free text in, storable text out. Control characters and bidi overrides gone. */
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

/** A photo only if it is one: a data URL of a real image type, within the cap. */
function photo(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length > MAX_SCRAP_PHOTO_BYTES) return null;
  return value;
}

// --------------------------------------------------------------------- POST

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const grams = Number(body.grams);
    if (!Number.isFinite(grams) || !Number.isInteger(grams) || grams < MIN_LOT_GRAMS || grams > MAX_LOT_GRAMS) {
      return fail(
        400,
        'BAD_WEIGHT',
        `Enter a weight between ${MIN_LOT_GRAMS} g and ${MAX_LOT_GRAMS / 1000} kg.`
      );
    }

    const rawMaterial = text(body.material, 60);
    const material = normaliseMaterial(rawMaterial);
    const notes = text(body.notes, MAX_NOTES);
    const photoUrl = photo(body.photoUrl);

    const clusterKey = await clusterKeyFor(artisanId);
    if (!clusterKey) {
      return fail(
        409,
        'NO_CLUSTER',
        'Add your village or town to your profile first — scrap is pooled by cluster, so there is nowhere to pool this yet.'
      );
    }

    // One transaction: the pool, the lot and the recompute either all land or
    // none do. A lot attached to a pool whose total was never recomputed would
    // be weight the cluster has but the board cannot see.
    const result = await prisma.$transaction(async (tx) => {
      // Before anything is read: two artisans in the same village logging the
      // same material in the same second would otherwise each recompute a total
      // that is missing the other's lot.
      await lockPoolLane(tx, clusterKey, material);
      const pool = await findOrCreateLivePool(tx, clusterKey, material);
      const lot = await tx.scrapLot.create({
        data: {
          artisanId,
          clusterKey,
          material,
          grams,
          photoUrl,
          notes: notes || null,
          // POOLED at once: this lot is in a pool from the moment it exists.
          // The LOGGED default covers a row that somehow has no pool at all.
          status: 'POOLED',
          pooledLotId: pool.id,
        },
        select: { id: true, grams: true, loggedAt: true },
      });
      const state = await recomputePool(tx, pool.id);
      return { lot, state };
    });

    const state = result.state;
    if (state && state.previousStatus === 'OPEN' && state.status === 'LISTED') {
      console.info(
        `[scrap] pool ${state.id} (${state.clusterKey} / ${state.material}) listed at ${state.totalGrams} g, threshold ${LOT_THRESHOLD_GRAMS[material]} g`
      );
      const contributors = await poolContributorIds(state.id);
      await notifyCluster(
        contributors,
        scrapListedTitle(material),
        `Your cluster's pooled ${material.toLowerCase().replace(/_/g, ' ')} has reached ${Math.round(
          state.totalGrams / 100
        ) / 10} kg and is now on the public scrap board. Nothing is sold and no price is set — recyclers can now send an enquiry.`
      ).catch((error) => console.warn('[scrap] listed notify failed:', (error as Error)?.message));
    }

    return NextResponse.json(
      {
        success: true,
        lot: {
          id: result.lot.id,
          grams: result.lot.grams,
          material,
          // The artisan typed something this app could not pool; the screen
          // says so rather than pretending the label was understood.
          materialWasRecognised: material !== 'OTHER' || /^other$/i.test(rawMaterial),
          loggedAt: result.lot.loggedAt.toISOString(),
        },
        pool: state
          ? {
              id: state.id,
              material,
              totalGrams: state.totalGrams,
              thresholdGrams: LOT_THRESHOLD_GRAMS[material],
              contributorCount: state.contributorCount,
              status: state.status,
              justListed: state.previousStatus === 'OPEN' && state.status === 'LISTED',
            }
          : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[artisan/scrap] log failed:', error);
    return fail(500, 'LOG_FAILED', (error as Error)?.message || 'Could not log that scrap.');
  }
}

// ---------------------------------------------------------------------- GET

export async function GET() {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const clusterKey = await clusterKeyFor(artisanId);

    const [lots, earnings] = await Promise.all([
      prisma.scrapLot.findMany({
        where: { artisanId },
        orderBy: { loggedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          material: true,
          grams: true,
          notes: true,
          photoUrl: true,
          status: true,
          pooledLotId: true,
          loggedAt: true,
        },
      }),
      readScrapEarnings(artisanId),
    ]);

    if (!clusterKey) {
      return NextResponse.json({
        success: true,
        clusterKey: null,
        area: null,
        lots: [],
        pools: [],
        earnings,
        thresholds: LOT_THRESHOLD_GRAMS,
      });
    }

    const [poolRows, area] = await Promise.all([
      prisma.scrapPool.findMany({
        // A pool everyone has withdrawn from still exists — it is the row the
        // next lot will join — but there is nothing to show about it, and a
        // card reading "0 g of 5 kg, 0 contributing" implies the cluster is
        // collecting something nobody has.
        where: { clusterKey, totalGrams: { gt: 0 } },
        orderBy: [{ status: 'asc' }, { totalGrams: 'desc' }],
        take: 40,
        select: {
          id: true,
          material: true,
          totalGrams: true,
          contributorCount: true,
          status: true,
          listedAt: true,
          soldAt: true,
          salePriceRupees: true,
          _count: { select: { enquiries: true } },
        },
      }),
      clusterAreaLabel(clusterKey),
    ]);

    // This artisan's own weight in each pool, so the page can show a real share
    // percentage rather than an assumed equal split.
    const mine = await prisma.scrapLot.groupBy({
      by: ['pooledLotId'],
      where: {
        artisanId,
        pooledLotId: { in: poolRows.map((row) => row.id) },
        status: { in: ['LOGGED', 'POOLED', 'SOLD'] },
      },
      _sum: { grams: true },
    });
    const myGrams = new Map(mine.map((row) => [row.pooledLotId ?? '', row._sum.grams ?? 0]));

    return NextResponse.json({
      success: true,
      clusterKey,
      area,
      thresholds: LOT_THRESHOLD_GRAMS,
      lots: lots.map((lot) => ({
        id: lot.id,
        material: normaliseMaterial(lot.material),
        grams: lot.grams,
        notes: lot.notes,
        photoUrl: lot.photoUrl,
        status: lot.status,
        poolId: lot.pooledLotId,
        loggedAt: lot.loggedAt.toISOString(),
      })),
      pools: poolRows.map((pool) => {
        const material = normaliseMaterial(pool.material) as ScrapMaterial;
        const myWeight = myGrams.get(pool.id) ?? 0;
        return {
          id: pool.id,
          material,
          totalGrams: pool.totalGrams,
          thresholdGrams: LOT_THRESHOLD_GRAMS[material],
          contributorCount: pool.contributorCount,
          status: pool.status,
          listedAt: pool.listedAt?.toISOString() ?? null,
          soldAt: pool.soldAt?.toISOString() ?? null,
          // Null until a human records what a recycler really paid. There is no
          // estimate here because there is no feed to estimate from.
          salePriceRupees: pool.salePriceRupees,
          enquiryCount: pool._count.enquiries,
          myGrams: myWeight,
          mySharePercent: sharePercent(myWeight, pool.totalGrams),
        };
      }),
      earnings,
    });
  } catch (error) {
    console.error('[artisan/scrap] read failed:', error);
    return fail(500, 'READ_FAILED', 'Could not load your scrap ledger.');
  }
}

// ------------------------------------------------------------------- DELETE

export async function DELETE(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!id) return fail(400, 'BAD_REQUEST', 'Say which lot to withdraw.');

    const lot = await prisma.scrapLot.findUnique({
      where: { id },
      select: {
        id: true,
        artisanId: true,
        clusterKey: true,
        material: true,
        grams: true,
        status: true,
        pooledLotId: true,
        pool: { select: { id: true, status: true } },
      },
    });
    if (!lot || lot.artisanId !== artisanId) {
      return fail(404, 'NOT_FOUND', 'That scrap lot is not yours or no longer exists.');
    }
    if (lot.status === 'WITHDRAWN') {
      return fail(409, 'ALREADY_WITHDRAWN', 'You have already taken this lot back.');
    }
    // A sold pool is closed: the weight in it is what a recycler paid for, and
    // taking a lot out of it afterwards would misstate what was sold.
    if (lot.pool?.status === 'SOLD' || lot.status === 'SOLD') {
      return fail(409, 'POOL_SOLD', 'This pool has already been sold, so its lots can no longer be taken back.');
    }

    const state = await prisma.$transaction(async (tx) => {
      // The same lane as a log, so a withdrawal and a contribution landing
      // together cannot each recompute from a half-seen lot table.
      await lockPoolLane(tx, lot.clusterKey, lot.material);
      const claimed = await tx.scrapLot.updateMany({
        where: { id, artisanId, status: { in: ['LOGGED', 'POOLED'] } },
        data: { status: 'WITHDRAWN', pooledLotId: null },
      });
      if (claimed.count === 0) return null;
      return lot.pooledLotId ? await recomputePool(tx, lot.pooledLotId) : null;
    });

    if (state && state.previousStatus === 'LISTED' && state.status === 'OPEN') {
      // Logged because it is the one state change in this feature that takes
      // something away from a cluster, and a demotion nobody can see is a
      // demotion nobody can question.
      console.info(
        `[scrap] pool ${state.id} (${state.clusterKey} / ${state.material}) demoted to OPEN at ${state.totalGrams} g, below threshold ${LOT_THRESHOLD_GRAMS[normaliseMaterial(state.material)]} g`
      );
      const contributors = await poolContributorIds(state.id);
      await notifyCluster(
        contributors,
        scrapDemotedTitle(normaliseMaterial(state.material)),
        'A contributor took their scrap back, so this pool is under the minimum weight again and has come off the public board. It will go back on as soon as the weight is there.'
      ).catch((error) => console.warn('[scrap] demote notify failed:', (error as Error)?.message));
    }

    return NextResponse.json({
      success: true,
      withdrawn: state !== null,
      pool: state
        ? {
            id: state.id,
            totalGrams: state.totalGrams,
            contributorCount: state.contributorCount,
            status: state.status,
            demoted: state.previousStatus === 'LISTED' && state.status === 'OPEN',
          }
        : null,
    });
  } catch (error) {
    console.error('[artisan/scrap] withdraw failed:', error);
    return fail(500, 'WITHDRAW_FAILED', 'Could not take that lot back.');
  }
}
