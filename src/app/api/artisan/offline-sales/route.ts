import { NextResponse, after } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireArtisan } from '@/lib/artisanAuth';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { SOLD_STATUSES } from '@/lib/storefrontSale';
import { SHOPIFY_CONFIGURED, withdrawSoldPiece } from '@/lib/shopify';
import { awardBadges } from '@/lib/badgeRecord';
import {
  MAX_BUYER_NAME_LENGTH,
  MAX_CRAFT_LABEL_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_OFFLINE_AMOUNT,
  MAX_OFFLINE_QUANTITY,
  MIN_ONLINE_SAMPLES,
  MIN_PRICE_SAMPLES,
  OFFLINE_SALE_UNDO_HOURS,
  PRICE_SIGNAL_WINDOW_DAYS,
  SOLD_OFFLINE,
  buildComparison,
  buildPriceSignal,
  cleanText,
  highAmountThreshold,
  isOfflineChannel,
  istMonthKey,
  median,
  normaliseCraftLabel,
  parseAmountInput,
  soldAtFromInput,
  unitPrice,
  type OfflineSaleErrorCode,
} from '@/lib/offlineSales';

export const dynamic = 'force-dynamic';

/**
 * The artisan's offline sale ledger.
 *
 *   GET     the ledger, its totals, the local price signal and — only when both
 *           thresholds are met — the offline/online comparison
 *   POST    log one sale (also what the offline queue replays)
 *   DELETE  undo a row inside OFFLINE_SALE_UNDO_HOURS
 *
 * Nothing here touches an escrow column. Karigari moved no money for these
 * sales, and the figures they produce are always a separate, labelled stream.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A thumbnail URL a list row can render without carrying the photo itself. */
function thumbnailFor(id: string, images: string[] | null | undefined): string | null {
  const first = images?.[0];
  if (!first) return null;
  return first.startsWith('data:') ? `/api/items/${id}/thumbnail` : first;
}

function fail(status: number, code: OfflineSaleErrorCode, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, code, error, ...extra }, { status });
}

/** Thrown inside the transaction so it rolls back, then turned into a response. */
class SaleRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: OfflineSaleErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

/** The artisan's per-unit median across every craft, only when one legitimately exists. */
function ownMedianUnit(rows: { amount: number; quantity: number }[]): number | null {
  const units = rows.map(unitPrice).filter((v): v is number => v !== null);
  return units.length >= MIN_PRICE_SAMPLES ? median(units) : null;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  try {
    const url = new URL(req.url);
    const requestedCraft = normaliseCraftLabel(url.searchParams.get('craft'));
    const withPieces = url.searchParams.get('pieces') === '1';

    const now = new Date();
    const windowStart = new Date(now.getTime() - PRICE_SIGNAL_WINDOW_DAYS * DAY_MS);

    const [recent, aggregate, windowRows, onlineSold, labelRows, pieceRows] = await Promise.all([
      prisma.offlineSale.findMany({
        where: { artisanId },
        orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          craftItemId: true,
          craftTypeLabel: true,
          amount: true,
          quantity: true,
          channel: true,
          buyerName: true,
          soldAt: true,
          notes: true,
          captureMethod: true,
          createdAt: true,
        },
      }),
      prisma.offlineSale.aggregate({
        where: { artisanId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Everything the signal, the month totals and the high-amount check need.
      // The window reaches back further than the start of last month, so both
      // month totals are exact.
      prisma.offlineSale.findMany({
        where: { artisanId, soldAt: { gte: windowStart } },
        select: { craftTypeLabel: true, amount: true, quantity: true, soldAt: true },
      }),
      // The online side of the comparison: pieces a buyer actually paid a
      // price for. Never an AI valuation.
      prisma.craftItem.findMany({
        where: {
          artisanId,
          status: { in: ['SOLD_FINAL', 'PAYOUT_COMPLETED'] },
          salePrice: { not: null },
        },
        select: { craftType: true, salePrice: true, askingPrice: true, paidAt: true, createdAt: true },
      }),
      prisma.offlineSale.findMany({
        where: { artisanId },
        distinct: ['craftTypeLabel'],
        orderBy: { craftTypeLabel: 'asc' },
        take: 40,
        select: { craftTypeLabel: true },
      }),
      withPieces
        ? prisma.craftItem.findMany({
            // A piece Karigari already has money against cannot be sold at a
            // haat: paid, in escrow, or advanced to the artisan.
            where: {
              artisanId,
              paidAt: null,
              escrowStatus: null,
              advancePaid: 0,
              status: { notIn: [...SOLD_STATUSES] },
            },
            orderBy: { createdAt: 'desc' },
            take: 24,
            select: {
              id: true,
              craftType: true,
              patchId: true,
              status: true,
              images: true,
              askingPrice: true,
              standardMarketPrice: true,
              fairWageFloor: true,
            },
          })
        : Promise.resolve([]),
    ]);

    // ---- totals ---------------------------------------------------------
    const thisMonthKey = istMonthKey(now);
    const lastMonthDate = new Date(`${thisMonthKey}-01T12:00:00+05:30`);
    lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1);
    const lastMonthKey = istMonthKey(lastMonthDate);
    let thisMonth = 0;
    let lastMonth = 0;
    for (const row of windowRows) {
      const key = istMonthKey(row.soldAt);
      if (key === thisMonthKey) thisMonth += row.amount;
      else if (key === lastMonthKey) lastMonth += row.amount;
    }

    // ---- which craft the signal describes ---------------------------------
    const byLabel = new Map<string, { display: string; rows: typeof windowRows; latest: number }>();
    for (const row of windowRows) {
      const key = normaliseCraftLabel(row.craftTypeLabel);
      const entry = byLabel.get(key) ?? { display: row.craftTypeLabel, rows: [], latest: 0 };
      entry.rows.push(row);
      if (row.soldAt.getTime() >= entry.latest) {
        entry.latest = row.soldAt.getTime();
        entry.display = row.craftTypeLabel;
      }
      byLabel.set(key, entry);
    }

    // The craft asked about, or else the one the artisan has logged most.
    let selectedKey: string | null = requestedCraft || null;
    if (!selectedKey) {
      let best: { key: string; count: number; latest: number } | null = null;
      for (const [key, entry] of byLabel) {
        if (!best || entry.rows.length > best.count || (entry.rows.length === best.count && entry.latest > best.latest)) {
          best = { key, count: entry.rows.length, latest: entry.latest };
        }
      }
      selectedKey = best?.key ?? null;
    }
    const selected = selectedKey ? byLabel.get(selectedKey) : undefined;
    const selectedDisplay = selected?.display ?? url.searchParams.get('craft')?.trim() ?? null;

    const onlineRows = selectedKey
      ? onlineSold
          .filter((item) => normaliseCraftLabel(item.craftType) === selectedKey)
          .map((item) => ({ salePrice: item.salePrice, askingPrice: item.askingPrice, soldAt: item.paidAt ?? item.createdAt }))
      : [];
    const onlineInWindow = onlineRows.filter((row) => row.soldAt.getTime() >= windowStart.getTime()).length;

    const signal = selected ? buildPriceSignal(selected.rows, selected.display, now) : null;
    const comparison =
      selected && selectedDisplay ? buildComparison(selected.rows, onlineRows, selectedDisplay, now) : null;

    const ownMedian = ownMedianUnit(windowRows);
    const undoCutoff = now.getTime() - OFFLINE_SALE_UNDO_HOURS * HOUR_MS;

    return NextResponse.json({
      success: true,
      sales: recent.map((sale) => ({
        ...sale,
        soldAt: sale.soldAt.toISOString(),
        createdAt: sale.createdAt.toISOString(),
        undoUntil:
          sale.createdAt.getTime() > undoCutoff
            ? new Date(sale.createdAt.getTime() + OFFLINE_SALE_UNDO_HOURS * HOUR_MS).toISOString()
            : null,
      })),
      totals: {
        offlineTotal: aggregate._sum.amount ?? 0,
        offlineCount: aggregate._count._all,
        thisMonth,
        lastMonth,
      },
      signal,
      comparison,
      // What the not-enough-data states need to name their own shortfall.
      progress: {
        craftTypeLabel: selectedDisplay,
        offlineSamples: selected?.rows.length ?? 0,
        onlineSamples: onlineInWindow,
        minPriceSamples: MIN_PRICE_SAMPLES,
        minOnlineSamples: MIN_ONLINE_SAMPLES,
        windowDays: PRICE_SIGNAL_WINDOW_DAYS,
      },
      ownMedianUnit: ownMedian,
      highAmountThreshold: highAmountThreshold(ownMedian),
      labels: labelRows.map((row) => row.craftTypeLabel),
      pieces: pieceRows.map((piece) => ({
        id: piece.id,
        craftType: piece.craftType,
        patchId: piece.patchId,
        status: piece.status,
        thumbnail: thumbnailFor(piece.id, piece.images),
        price: piece.askingPrice ?? piece.standardMarketPrice ?? piece.fairWageFloor ?? null,
      })),
      undoHours: OFFLINE_SALE_UNDO_HOURS,
    });
  } catch (error) {
    console.error('[offline-sales] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Could not load your offline sales.' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return fail(400, 'AMOUNT_INVALID', 'Send the sale as JSON.');
  }

  // ---- validation, each field with its own answer -----------------------
  const amount = parseAmountInput(body.amount);
  if (amount === null || amount < 1) {
    return fail(400, 'AMOUNT_INVALID', 'Enter the amount you received in whole rupees.');
  }
  if (amount > MAX_OFFLINE_AMOUNT) {
    return fail(400, 'AMOUNT_TOO_LARGE', 'That amount is too large for one sale. Check for an extra zero.');
  }

  const quantity = body.quantity === undefined || body.quantity === null || body.quantity === '' ? 1 : parseAmountInput(body.quantity);
  if (quantity === null || quantity < 1 || quantity > MAX_OFFLINE_QUANTITY) {
    return fail(400, 'QUANTITY_INVALID', `Quantity must be between 1 and ${MAX_OFFLINE_QUANTITY}.`);
  }

  const when = soldAtFromInput(body.soldAt);
  if (!when.ok) {
    if (when.reason === 'future') return fail(400, 'SOLD_AT_FUTURE', 'The sale date cannot be in the future.');
    if (when.reason === 'too_old') return fail(400, 'SOLD_AT_TOO_OLD', 'That sale is more than two years old.');
    return fail(400, 'SOLD_AT_INVALID', 'Choose the day the sale happened.');
  }

  const craftTypeLabel = cleanText(body.craftTypeLabel, MAX_CRAFT_LABEL_LENGTH + 1);
  if (!craftTypeLabel) return fail(400, 'LABEL_REQUIRED', 'Say what you sold.');
  if (craftTypeLabel.length > MAX_CRAFT_LABEL_LENGTH) {
    return fail(400, 'LABEL_REQUIRED', `Keep what you sold under ${MAX_CRAFT_LABEL_LENGTH} characters.`);
  }

  // An unknown channel is recorded as OTHER rather than refused: an artisan
  // must never lose a sale to a validation error on an optional detail.
  const channelInput = typeof body.channel === 'string' ? body.channel.trim().toUpperCase() : '';
  const channel = isOfflineChannel(channelInput) ? channelInput : 'OTHER';
  const buyerName = cleanText(body.buyerName, MAX_BUYER_NAME_LENGTH);
  const notes = cleanText(body.notes, MAX_NOTES_LENGTH);
  const captureMethod = body.captureMethod === 'VOICE' ? 'VOICE' : 'MANUAL';
  const voiceLanguage =
    captureMethod === 'VOICE' && ['en', 'hi', 'or', 'te'].includes(body.voiceLanguage) ? body.voiceLanguage : null;
  const craftItemId = typeof body.craftItemId === 'string' && body.craftItemId.trim() ? body.craftItemId.trim() : null;

  try {
    // ---- "is that really the amount?" ------------------------------------
    // Asked, never enforced: the artisan confirms and the sale is saved.
    if (body.confirmHighAmount !== true) {
      const windowStart = new Date(Date.now() - PRICE_SIGNAL_WINDOW_DAYS * DAY_MS);
      const history = await prisma.offlineSale.findMany({
        where: { artisanId, soldAt: { gte: windowStart } },
        select: { amount: true, quantity: true },
      });
      const ownMedian = ownMedianUnit(history);
      const threshold = highAmountThreshold(ownMedian);
      if (amount / quantity > threshold) {
        return fail(422, 'AMOUNT_HIGH', 'That amount is much higher than usual. Confirm it is correct.', {
          ownMedianUnit: ownMedian,
          threshold,
        });
      }
    }

    const data = {
      artisanId,
      craftTypeLabel,
      amount,
      quantity,
      channel,
      buyerName,
      soldAt: when.soldAt,
      notes,
      captureMethod,
      voiceLanguage,
    };

    // An offline sale is still a sale they made, so it can earn FIRST_SALE or
    // TEN_SALES. Fire-and-forget on both write paths below.
    const awardAfterSale = () =>
      void awardBadges(artisanId).catch((error) => {
        console.warn('[badges] award after offline sale failed:', (error as Error)?.message);
      });

    if (!craftItemId) {
      const sale = await prisma.offlineSale.create({ data });
      awardAfterSale();
      return NextResponse.json({ success: true, sale }, { status: 201 });
    }

    // ---- a catalogued piece: status change and row insert, together ------
    const { sale, shopifyLive } = await prisma.$transaction(async (tx) => {
      const piece = await tx.craftItem.findUnique({
        where: { id: craftItemId },
        select: {
          id: true,
          artisanId: true,
          status: true,
          paidAt: true,
          escrowStatus: true,
          advancePaid: true,
          shopifyStatus: true,
        },
      });
      if (!piece) throw new SaleRefusal(404, 'PIECE_NOT_FOUND', 'That piece is not in your catalogue.');
      if (piece.artisanId !== artisanId) {
        throw new SaleRefusal(403, 'PIECE_NOT_YOURS', 'That piece belongs to another artisan.');
      }
      // A paid piece is spoken for, whether or not it has shipped.
      if (piece.paidAt) {
        throw new SaleRefusal(409, 'PIECE_SOLD_ONLINE', 'This piece was already bought online.', {
          soldOnlineAt: piece.paidAt.toISOString(),
        });
      }
      if ((SOLD_STATUSES as readonly string[]).includes(piece.status)) {
        throw new SaleRefusal(409, 'PIECE_ALREADY_SOLD', 'This piece is already marked as sold.');
      }
      if (piece.escrowStatus || piece.advancePaid > 0) {
        throw new SaleRefusal(
          409,
          'PIECE_HAS_PLATFORM_MONEY',
          'Karigari has already paid money against this piece, so it cannot be logged as an offline sale.'
        );
      }

      // Predicate on the status we just read: a buyer paying in the gap makes
      // this match nothing, and the log is refused rather than overwriting it.
      const moved = await tx.craftItem.updateMany({
        where: { id: piece.id, status: piece.status, paidAt: null, escrowStatus: null },
        data: { status: SOLD_OFFLINE },
      });
      if (moved.count !== 1) {
        throw new SaleRefusal(409, 'PIECE_ALREADY_SOLD', 'This piece changed while you were logging it. Refresh and try again.');
      }

      const created = await tx.offlineSale.create({ data: { ...data, craftItemId: piece.id } });

      await logCraftItemEvent({
        prisma: tx,
        craftItemId: piece.id,
        actorId: artisanId,
        actorRole: 'ARTISAN',
        action: 'SOLD_OFFLINE_LOGGED',
        previousState: { status: piece.status },
        newState: { status: SOLD_OFFLINE, offlineSaleId: created.id, channel, amount, quantity },
        comments: 'Logged by the artisan as sold outside Karigari. No platform money moved.',
      });

      return { sale: created, shopifyLive: piece.shopifyStatus === 'LIVE' };
    });

    // Off the artisan's Shopify shop too. Best effort and after the response:
    // a Shopify failure is recorded on the piece and never fails the log.
    if (SHOPIFY_CONFIGURED && shopifyLive) after(() => withdrawSoldPiece(sale.craftItemId as string, 'OFFLINE'));

    awardAfterSale();

    return NextResponse.json({ success: true, sale }, { status: 201 });
  } catch (error) {
    if (error instanceof SaleRefusal) return fail(error.status, error.code, error.message, error.extra);
    // Two devices logging the same piece: the @unique on craftItemId stops the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return fail(409, 'PIECE_ALREADY_SOLD', 'This piece has already been logged as sold.');
    }
    console.error('[offline-sales] POST failed:', error);
    return NextResponse.json({ success: false, error: 'Could not save the sale. Try again.' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — undo, inside the window
// ---------------------------------------------------------------------------

export async function DELETE(req: Request) {
  const auth = await requireArtisan();
  if (!auth.ok) return auth.response;
  const artisanId = auth.artisan.userId;

  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) return fail(400, 'NOT_FOUND', 'Which sale should be undone?');

  try {
    const sale = await prisma.offlineSale.findFirst({
      where: { id, artisanId },
      select: { id: true, craftItemId: true, createdAt: true },
    });
    if (!sale) return fail(404, 'NOT_FOUND', 'That sale is not in your ledger.');

    const cutoff = new Date(Date.now() - OFFLINE_SALE_UNDO_HOURS * HOUR_MS);
    if (sale.createdAt < cutoff) {
      return fail(409, 'UNDO_WINDOW_CLOSED', `A sale can only be undone within ${OFFLINE_SALE_UNDO_HOURS} hours of logging it.`);
    }

    const restoredStatus = await prisma.$transaction(async (tx) => {
      let restored: string | null = null;

      if (sale.craftItemId) {
        // The piece goes back to exactly what it was, as recorded when it was
        // delisted — never a status guessed now.
        const logged = await tx.auditLog.findFirst({
          where: { craftItemId: sale.craftItemId, action: 'SOLD_OFFLINE_LOGGED' },
          orderBy: { createdAt: 'desc' },
          select: { previousState: true },
        });
        const previous = (logged?.previousState as { status?: unknown } | null)?.status;
        if (typeof previous !== 'string' || !previous) {
          throw new SaleRefusal(409, 'NOT_FOUND', 'The piece’s earlier status was not recorded, so it cannot be restored.');
        }
        const moved = await tx.craftItem.updateMany({
          where: { id: sale.craftItemId, status: SOLD_OFFLINE },
          data: { status: previous },
        });
        if (moved.count !== 1) {
          throw new SaleRefusal(409, 'PIECE_ALREADY_SOLD', 'This piece has changed since it was logged, so the sale cannot be undone.');
        }
        await logCraftItemEvent({
          prisma: tx,
          craftItemId: sale.craftItemId,
          actorId: artisanId,
          actorRole: 'ARTISAN',
          action: 'SOLD_OFFLINE_REVERSED',
          previousState: { status: SOLD_OFFLINE },
          newState: { status: previous, offlineSaleId: sale.id },
          comments: 'The artisan undid an offline sale within the undo window.',
        });
        restored = previous;
      }

      const removed = await tx.offlineSale.deleteMany({
        where: { id: sale.id, artisanId, createdAt: { gte: cutoff } },
      });
      if (removed.count !== 1) {
        throw new SaleRefusal(409, 'UNDO_WINDOW_CLOSED', 'That sale can no longer be undone.');
      }
      return restored;
    });

    return NextResponse.json({ success: true, restoredStatus });
  } catch (error) {
    if (error instanceof SaleRefusal) return fail(error.status, error.code, error.message, error.extra);
    console.error('[offline-sales] DELETE failed:', error);
    return NextResponse.json({ success: false, error: 'Could not undo the sale. Try again.' }, { status: 500 });
  }
}
