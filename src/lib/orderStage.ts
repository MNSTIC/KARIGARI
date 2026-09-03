import { ESCROW_HELD, STAGE1_ADVANCE_PAID_40, STAGE2_SETTLED_89 } from '@/lib/escrow';

/**
 * The buyer-facing production ladder.
 *
 * There is no `Order` table in this schema — an order **is** a `CraftItem` —
 * so the ladder is derived from the fields that already record where a piece
 * has got to, rather than from a status column invented for the timeline:
 *
 *   ACCEPTED       the piece exists and is moving
 *   IN_PRODUCTION  the artisan said so (the one step nothing else records)
 *   QUALITY_CHECK  `qrVerified` — the printed patch matched the re-photograph
 *   DISPATCHED     `escrowStatus` reached the 40% advance, released on dispatch
 *   DELIVERED      `escrowStatus` settled, or the item is sold outright
 *
 * `productionStage` on the row only ever moves a piece **forward** of what the
 * escrow and verification fields prove. It can never drag one backwards: a
 * delivered item stays delivered even if someone writes IN_PRODUCTION to it.
 */

export const ORDER_STAGES = [
  'PLACED',
  'ACCEPTED',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
  'DISPATCHED',
  'DELIVERED',
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

/** i18n keys, in ladder order — the timeline renders these. */
export const ORDER_STAGE_KEYS: Record<OrderStage, string> = {
  PLACED: 'stage_placed',
  ACCEPTED: 'stage_accepted',
  IN_PRODUCTION: 'stage_in_production',
  QUALITY_CHECK: 'stage_quality_check',
  DISPATCHED: 'stage_dispatched',
  DELIVERED: 'stage_delivered',
};

/** Statuses that mean the piece is finished and paid for, whatever escrow says. */
const SOLD_STATUSES = new Set(['SOLD_FINAL', 'PAYOUT_COMPLETED']);

/** Statuses that mean an artisan has a real, moving piece rather than a draft. */
const DRAFT_STATUSES = new Set(['DRAFT_IVR', 'IVR_DRAFT', 'Pending']);

export interface StageInput {
  status?: string | null;
  escrowStatus?: string | null;
  qrVerified?: boolean | null;
  productionStage?: string | null;
}

export function stageIndex(stage: OrderStage): number {
  return ORDER_STAGES.indexOf(stage);
}

/** What the item's own escrow / verification fields prove on their own. */
function derivedStage(item: StageInput): OrderStage {
  const status = String(item.status ?? '');

  if (item.escrowStatus === STAGE2_SETTLED_89) return 'DELIVERED';
  // A sold status means delivered only when escrow is not still holding the
  // money. A verified Razorpay payment marks the piece SOLD_FINAL the instant
  // it is paid for, and that is the START of the buyer's ladder, not the end —
  // reading it as DELIVERED would tell a buyer their piece had arrived before
  // the artisan had even begun. Items sold through the admin's own sale flow
  // carry no escrow row at all, so they are unaffected.
  if (SOLD_STATUSES.has(status) && item.escrowStatus !== ESCROW_HELD) return 'DELIVERED';
  if (item.escrowStatus === STAGE1_ADVANCE_PAID_40) return 'DISPATCHED';
  if (item.qrVerified === true) return 'QUALITY_CHECK';
  // Money is held but nothing has shipped: the piece is committed and being
  // prepared, which is exactly what IN_PRODUCTION means to a buyer.
  if (item.escrowStatus === ESCROW_HELD) return 'IN_PRODUCTION';
  if (status && !DRAFT_STATUSES.has(status)) return 'ACCEPTED';
  return 'PLACED';
}

/**
 * The stage to show, taking the furthest of what is proven and what the artisan
 * has declared.
 */
export function resolveStage(item: StageInput): OrderStage {
  const derived = derivedStage(item);
  const declared = ORDER_STAGES.includes(item.productionStage as OrderStage)
    ? (item.productionStage as OrderStage)
    : null;
  if (!declared) return derived;
  return stageIndex(declared) > stageIndex(derived) ? declared : derived;
}

/** True once a piece counts towards a bulk demand's fulfilled total. */
export function isDelivered(item: StageInput): boolean {
  return resolveStage(item) === 'DELIVERED';
}

/**
 * The stages an artisan may set by hand.
 *
 * Everything past QUALITY_CHECK is written by the escrow engine on a real
 * dispatch or delivery trigger, so it is deliberately not offered here — an
 * artisan must not be able to tell a buyer a piece shipped when no money has
 * moved.
 */
export const ARTISAN_SETTABLE_STAGES: OrderStage[] = ['ACCEPTED', 'IN_PRODUCTION'];

/**
 * Units per day, measured from the demand being posted to the most recent
 * delivery. Null until at least one piece has actually been delivered —
 * a rate computed from zero deliveries is not a rate.
 */
export function fulfilmentRate(
  since: Date,
  deliveredAt: Date[]
): { perDay: number; days: number } | null {
  if (deliveredAt.length === 0) return null;
  const last = deliveredAt.reduce((a, b) => (a > b ? a : b));
  const ms = Math.max(last.getTime() - since.getTime(), 0);
  // Anything inside a day counts as one day; otherwise a same-day delivery
  // divides by zero and reports an infinite rate.
  const days = Math.max(1, ms / 86_400_000);
  return { perDay: deliveredAt.length / days, days };
}

/** When the remaining units would land at the observed rate. Null if unknowable. */
export function projectedCompletion(
  perDay: number,
  remaining: number
): Date | null {
  if (perDay <= 0 || remaining <= 0) return null;
  const daysLeft = remaining / perDay;
  // A projection further out than three years is noise, not information.
  if (!Number.isFinite(daysLeft) || daysLeft > 1095) return null;
  return new Date(Date.now() + daysLeft * 86_400_000);
}
