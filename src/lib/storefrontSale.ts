import { Prisma } from '@prisma/client';
import { getListingPrice } from '@/lib/pricing';
import { resolveStage, type OrderStage } from '@/lib/orderStage';

/**
 * A storefront sale, as an order.
 *
 * There is no Order table: a piece bought from the marketplace IS its
 * `CraftItem` row, carrying the payment, the escrow and — since the fulfilment
 * columns landed — the pack / dispatch / delivery timestamps. This module is
 * the one place that turns such a row into something the artisan's Orders page
 * and the buyer's order view can act on, so both sides agree on what step a
 * sale is at and what may happen next.
 *
 * It is deliberately separate from the demand-order code in
 * `src/app/api/artisan/orders`. A demand order is a commission against a
 * buyer's request, with negotiation, an advance and a ready-check. A storefront
 * sale is a finished, already-verified piece that someone bought outright. They
 * share the buyer's six-rung ladder (`resolveStage`), not their mechanics.
 */

// ---------------------------------------------------------------------------
// What may be bought
// ---------------------------------------------------------------------------

/**
 * Statuses that mean a piece has already been sold, however it was sold.
 *
 * `paidAt` alone is NOT enough to answer "is this sold". It is written only by
 * the Razorpay verify route, and a large share of the pieces in this database
 * were sold and fully settled through the escrow engine by rows that never had
 * it set — 31 of them, with ₹7 lakh of advances and final settlements already
 * released, were still listed and would have passed a `paidAt: null` check.
 * Buying one again would have rewritten a completed ledger back to "held".
 *
 * `SOLD_OFFLINE` is a piece the artisan logged as sold at a haat, to a walk-in
 * or through a middleman (see src/lib/offlineSales.ts). It is here so that one
 * physical object can never be sold twice; no money moved through Karigari for
 * it, so no escrow column is ever written on such a row.
 */
export const SOLD_STATUSES = ['SOLD_FINAL', 'SOLD_MIDDLEMAN', 'PAYOUT_COMPLETED', 'SOLD_OFFLINE'] as const;

/** Escrow states that mean money for this piece has already been released. */
export const SETTLED_ESCROW = ['STAGE1_ADVANCE_PAID_40', 'STAGE2_SETTLED_89'] as const;

/**
 * The QR gate: the patch was verified, OR the piece is grandfathered.
 *
 * `qrExemptAt` is set only by a one-time script, on the pieces that were
 * already listed when this rule began being enforced, so the existing demo
 * catalogue stayed buyable. No application code writes it — anything listed
 * later must pass real verification. See the column's note in schema.prisma.
 */
export const QR_CLEARED_WHERE = {
  OR: [{ qrVerified: true }, { qrExemptAt: { not: null } }],
} satisfies Prisma.CraftItemWhereInput;

/**
 * The ONE definition of a piece a buyer may purchase, as a Prisma filter.
 *
 * Used by every surface that offers a piece for sale — the storefront grid, the
 * demand matcher — and mirrored exactly by `isPurchasable()` below, which the
 * checkout route enforces. Before this existed each surface had its own idea,
 * and they disagreed: the grid offered pieces checkout then refused, which is
 * the "This piece is not available for sale" a buyer saw after pressing Buy.
 *
 *   listed        the artisan published it
 *   QR cleared    the printed patch was matched to the piece — the documented
 *                 gate for "sellable" — or the piece is grandfathered onto the
 *                 demo catalogue (QR_CLEARED_WHERE above)
 *   paidAt null   no Razorpay payment has been recorded against it
 *   status        not sold by any other route
 *   escrow        no tranche released
 *
 * THE ESCROW CLAUSE IS WRITTEN AS `null OR notIn` ON PURPOSE. Postgres
 * evaluates `NULL NOT IN (...)` as NULL, not true, so a bare
 * `escrowStatus: { notIn: [...] }` silently drops every row whose escrow is
 * null — which is every unsold piece. Measured against this database: the bare
 * form admitted 3 pieces, this form admits the correct 24.
 */
export const PURCHASABLE_WHERE = {
  isListedOnMarketplace: true,
  paidAt: null,
  status: { notIn: [...SOLD_STATUSES] },
  // Both clauses need an OR, and an object can only hold one `OR` key — a
  // second would silently replace the first. So they sit side by side in AND.
  AND: [
    QR_CLEARED_WHERE,
    { OR: [{ escrowStatus: null }, { escrowStatus: { notIn: [...SETTLED_ESCROW] } }] },
  ],
} satisfies Prisma.CraftItemWhereInput;

export interface PurchasableInput {
  isListedOnMarketplace: boolean;
  qrVerified: boolean;
  /** Optional so a caller that has not selected it is treated as not exempt. */
  qrExemptAt?: Date | string | null;
  paidAt: Date | string | null;
  status: string;
  escrowStatus: string | null;
}

/** Mirrors QR_CLEARED_WHERE: verified, or grandfathered onto the demo catalogue. */
export function isQrCleared(item: { qrVerified: boolean; qrExemptAt?: Date | string | null }): boolean {
  return item.qrVerified || Boolean(item.qrExemptAt);
}

/**
 * Why a piece cannot be bought, or null when it can. Mirrors PURCHASABLE_WHERE
 * clause for clause; the order decides which reason a buyer is shown.
 */
export function unpurchasableReason(item: PurchasableInput): 'sold' | 'unavailable' | null {
  if (
    item.paidAt ||
    (SOLD_STATUSES as readonly string[]).includes(item.status) ||
    (SETTLED_ESCROW as readonly string[]).includes(item.escrowStatus ?? '')
  ) {
    return 'sold';
  }
  if (!item.isListedOnMarketplace || !isQrCleared(item)) return 'unavailable';
  return null;
}

export function isPurchasable(item: PurchasableInput): boolean {
  return unpurchasableReason(item) === null;
}

/** Everything a storefront sale needs to be listed and acted on. */
export const SALE_SELECT = {
  id: true,
  artisanId: true,
  craftType: true,
  images: true,
  patchId: true,
  status: true,
  escrowStatus: true,
  qrVerified: true,
  qrExemptAt: true,
  productionStage: true,
  paidAt: true,
  packedAt: true,
  dispatchedAt: true,
  deliveredAt: true,
  courierName: true,
  trackingRef: true,
  buyerName: true,
  relatedDemandId: true,
  salePrice: true,
  askingPrice: true,
  standardMarketPrice: true,
  fairWageFloor: true,
  advanceAmount: true,
  finalSettlementAmount: true,
  advancePaid: true,
  finalPayoutQueued: true,
  payoutMode: true,
} satisfies Prisma.CraftItemSelect;

export type SaleRow = Prisma.CraftItemGetPayload<{ select: typeof SALE_SELECT }>;

/**
 * Which paid pieces are storefront sales for this artisan.
 *
 * `artisanOrders: { none: {} }` is load-bearing. A piece bought against a
 * demand the artisan had accepted is bound to that `ArtisanOrder` by
 * verify-payment, and the demand ladder already packs and dispatches it —
 * listing it here as well would put the same physical piece on the Orders page
 * twice, with two independent Dispatch buttons. A piece that merely matched a
 * demand the artisan never accepted has no binding, and is a storefront sale
 * like any other.
 */
export function storefrontSalesWhere(artisanId: string): Prisma.CraftItemWhereInput {
  return { artisanId, paidAt: { not: null }, artisanOrders: { none: {} } };
}

/** What the artisan may do next. Null when the step is someone else's. */
export type ArtisanSaleAction = 'pack' | 'dispatch';

/**
 * The single next action for the artisan, or null.
 *
 * Null after dispatch on purpose: delivery is confirmed by the BUYER, because it
 * is the step that releases the artisan's own final settlement. An artisan who
 * could mark their own sale delivered could pay themselves before shipping.
 */
export function nextArtisanAction(sale: Pick<SaleRow, 'paidAt' | 'packedAt' | 'dispatchedAt' | 'deliveredAt'>): ArtisanSaleAction | null {
  if (!sale.paidAt || sale.deliveredAt) return null;
  if (!sale.packedAt) return 'pack';
  if (!sale.dispatchedAt) return 'dispatch';
  return null;
}

/**
 * Two contact strings refer to the same person.
 *
 * Digits only, last ten: the buyer types this by hand at checkout and again at
 * delivery, and "+91 98765 43210" and "9876543210" are the same phone. An empty
 * side never matches — "both blank" is not a match, it is no evidence.
 */
export function contactsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const last10 = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '').slice(-10);
  const left = last10(a);
  const right = last10(b);
  return left.length > 0 && left === right;
}

/** The artisan-facing shape. Never carries the buyer's contact. */
export function toArtisanSale(sale: SaleRow) {
  const price = sale.salePrice ?? getListingPrice(sale);
  const stage: OrderStage = resolveStage(sale);
  return {
    kind: 'storefront' as const,
    id: sale.id,
    craftType: sale.craftType,
    image: sale.images?.[0] ?? null,
    // The artisan's own patch, so they can match the physical sticker to the
    // order when packing. Not a secret from the person who printed it.
    patchId: sale.patchId,
    stage,
    nextAction: nextArtisanAction(sale),
    buyerName: sale.buyerName,
    price,
    paidAt: sale.paidAt?.toISOString() ?? null,
    packedAt: sale.packedAt?.toISOString() ?? null,
    dispatchedAt: sale.dispatchedAt?.toISOString() ?? null,
    deliveredAt: sale.deliveredAt?.toISOString() ?? null,
    courierName: sale.courierName,
    trackingRef: sale.trackingRef,
    escrowStatus: sale.escrowStatus,
    // What the artisan is owed and what has been released, from the ledger —
    // not recomputed here, so the page shows exactly what settlement recorded.
    advanceAmount: sale.advanceAmount,
    finalSettlementAmount: sale.finalSettlementAmount,
    advanceReleased: sale.advancePaid,
    finalReleased: sale.finalPayoutQueued,
    // False means the ledger moved but no bank credit was made. The page must
    // say so rather than imply money arrived.
    payoutReal: sale.payoutMode === 'RAZORPAYX',
    relatedDemandId: sale.relatedDemandId,
  };
}

export type ArtisanSale = ReturnType<typeof toArtisanSale>;
