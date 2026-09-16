import { prisma } from '@/lib/prisma';
import {
  PRICE_SIGNAL_WINDOW_DAYS,
  buildPriceSignal,
  normaliseCraftLabel,
  type OfflinePriceSignal,
} from '@/lib/offlineSales';

/**
 * The artisan's own real local sale price for a craft, for the pricing
 * endpoints to return beside the AI band.
 *
 * It informs the band and never replaces it. Null — and then not shown at
 * all — until `MIN_PRICE_SAMPLES` offline sales of that exact craft fall inside
 * the window. A lookup failure is also null: a price estimate must never fail
 * because the ledger could not be read.
 */
export async function localMarketSignalFor(
  artisanId: string,
  craftLabel: string | null | undefined
): Promise<OfflinePriceSignal | null> {
  const key = normaliseCraftLabel(craftLabel);
  if (!key) return null;
  try {
    const now = new Date();
    const rows = await prisma.offlineSale.findMany({
      where: {
        artisanId,
        soldAt: { gte: new Date(now.getTime() - PRICE_SIGNAL_WINDOW_DAYS * 86_400_000) },
        // Narrowed in the database case-insensitively, then matched exactly on
        // the normalised label below so internal spacing is handled too.
        craftTypeLabel: { contains: key.split(' ')[0], mode: 'insensitive' },
      },
      // Newest first, so the label shown is the spelling the artisan used last.
      orderBy: { soldAt: 'desc' },
      select: { craftTypeLabel: true, amount: true, quantity: true, soldAt: true },
    });
    const matching = rows.filter((row) => normaliseCraftLabel(row.craftTypeLabel) === key);
    return buildPriceSignal(matching, matching[0]?.craftTypeLabel ?? String(craftLabel).trim(), now);
  } catch (error) {
    console.warn('[localMarketSignal] unavailable:', (error as Error)?.message);
    return null;
  }
}
