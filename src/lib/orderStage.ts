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

/**
 * The demand-order ladder, and the two status vocabularies it is built on.
 *
 * A demand order is not a `CraftItem`: it has no escrow row, no `qrVerified`
 * flag and no `productionStage`, so `derivedStage()` below can never see it
 * move. V9 gives it its own columns (`readyVerified`, `packedAt`,
 * `dispatchedAt`, `settledAt`) and maps them onto the SAME six-rung ladder the
 * buyer already reads, so one timeline component renders both kinds of order.
 *
 * Both vocabularies are ordered, and every writer goes through the two
 * `advance*` helpers rather than assigning a literal — that is what makes the
 * whole lifecycle monotonic. An endpoint that writes `status` directly is a bug.
 */

/** `Demand.status`, in order. CANCELLED is terminal and sits off the ladder. */
export const DEMAND_STATUSES = ['OPEN', 'MATCHED', 'IN_PRODUCTION', 'FULFILLED'] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number] | 'CANCELLED';

/** `ArtisanOrder.status`, in order. CANCELLED is terminal and sits off the ladder. */
export const ORDER_STATUSES = [
  'ACCEPTED',
  'IN_PROGRESS',
  'READY',
  'PACKED',
  'DISPATCHED',
  'DELIVERED',
  'COMPLETED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number] | 'CANCELLED';

/** Statuses that take an order out of the artisan's active list. */
export const TERMINAL_ORDER_STATUSES: readonly string[] = ['DELIVERED', 'COMPLETED', 'CANCELLED'];

/**
 * The next status to write, or the current one when `next` would be a step
 * backwards.
 *
 * A cancelled row is never revived, and an unknown current value (a row written
 * by something older than this vocabulary) is treated as rank -1 so the caller's
 * intended value wins rather than being silently dropped.
 */
function advance(ladder: readonly string[], current: string | null | undefined, next: string): string {
  if (current === 'CANCELLED') return 'CANCELLED';
  const from = ladder.indexOf(current ?? '');
  const to = ladder.indexOf(next);
  if (to < 0) return current ?? next;
  return to > from ? next : (current ?? next);
}

export function advanceDemandStatus(
  current: string | null | undefined,
  next: (typeof DEMAND_STATUSES)[number]
): string {
  return advance(DEMAND_STATUSES, current, next);
}

export function advanceOrderStatus(
  current: string | null | undefined,
  next: (typeof ORDER_STATUSES)[number]
): string {
  return advance(ORDER_STATUSES, current, next);
}

/** What an `ArtisanOrder` needs to expose for its stage to be resolved. */
export interface DemandOrderStageInput {
  status?: string | null;
  readyVerified?: boolean | null;
  readyVerifiedAt?: Date | string | null;
  packedAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  settledAt?: Date | string | null;
  lastLogAt?: Date | string | null;
}

/**
 * Where one demand order has actually got to.
 *
 * Timestamps outrank the status column: they are written by the endpoint that
 * performed the act, whereas `status` is a label that a future migration or a
 * hand-edit could disagree with. Reading both means a row whose status was
 * never updated still shows the furthest thing it can prove.
 *
 * READY and PACKED both land on QUALITY_CHECK. The ladder is deliberately NOT
 * extended with a PACKED rung: `ORDER_STAGES` is shared with every storefront
 * `CraftItem`, which has no pack step, and adding one would leave a permanently
 * unreachable rung on every one of those timelines. The pack timestamp renders
 * as a sub-label on QUALITY_CHECK instead.
 */
export function demandOrderStage(order: DemandOrderStageInput): OrderStage {
  const status = String(order.status ?? '');

  if (order.settledAt || status === 'DELIVERED' || status === 'COMPLETED') return 'DELIVERED';
  if (order.dispatchedAt || status === 'DISPATCHED') return 'DISPATCHED';
  if (order.packedAt || order.readyVerified === true || status === 'PACKED' || status === 'READY') {
    return 'QUALITY_CHECK';
  }
  if (order.lastLogAt || status === 'IN_PROGRESS') return 'IN_PRODUCTION';
  if (status === 'ACCEPTED') return 'ACCEPTED';
  return 'PLACED';
}

/**
 * The stage for a demand order, taking the furthest of the order's own state
 * and any piece bound to it.
 *
 * The bound `CraftItem` matters because a buyer who paid through the storefront
 * drives that item's escrow ladder independently: the item can be DISPATCHED by
 * the escrow engine while the order row still says PACKED. Taking the furthest
 * of the two is the same rule `resolveStage()` already applies to a declared
 * versus a derived stage.
 */
export function resolveDemandStage(
  order: DemandOrderStageInput,
  item?: StageInput | null
): OrderStage {
  const fromOrder = demandOrderStage(order);
  if (!item) return fromOrder;
  const fromItem = resolveStage(item);
  return stageIndex(fromItem) > stageIndex(fromOrder) ? fromItem : fromOrder;
}

/**
 * i18n keys for the eight demand-order statuses.
 *
 * Separate from `ORDER_STAGE_KEYS` on purpose. Those six are the rungs of the
 * buyer's ladder; these eight are what the ARTISAN's own stepper shows, and
 * READY / PACKED have no rung of their own. Keeping them in one record would
 * imply the ladder has eight steps, which is exactly the confusion the note on
 * `demandOrderStage()` is guarding against.
 */
/** i18n keys for `Demand.status`, for the buyer board's per-demand pill. */
export const DEMAND_STATUS_KEYS: Record<string, string> = {
  OPEN: 'demand_status_open',
  MATCHED: 'demand_status_matched',
  IN_PRODUCTION: 'demand_status_in_production',
  FULFILLED: 'demand_status_fulfilled',
  CANCELLED: 'demand_status_cancelled',
};

export const ORDER_STATUS_KEYS: Record<string, string> = {
  ACCEPTED: 'order_status_accepted',
  IN_PROGRESS: 'order_status_in_progress',
  READY: 'stage_ready',
  PACKED: 'stage_packed',
  DISPATCHED: 'order_status_dispatched',
  DELIVERED: 'order_status_delivered',
  COMPLETED: 'order_status_completed',
  CANCELLED: 'order_status_cancelled',
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
  /**
   * Storefront fulfilment timestamps. Optional so every existing caller that
   * selects only the four fields above keeps compiling and keeps its old
   * answer — an absent timestamp simply contributes nothing.
   */
  packedAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
}

export function stageIndex(stage: OrderStage): number {
  return ORDER_STAGES.indexOf(stage);
}

/**
 * What the item's own escrow / verification / fulfilment fields prove on their
 * own.
 *
 * ORDER MATTERS, and the order is "most specific evidence first". Timestamps
 * are written by the endpoint that performed the act, so they outrank labels —
 * the same rule `demandOrderStage()` applies to demand orders.
 */
function derivedStage(item: StageInput): OrderStage {
  const status = String(item.status ?? '');

  if (item.deliveredAt || item.escrowStatus === STAGE2_SETTLED_89) return 'DELIVERED';

  // The escrow ladder BEFORE the sold check. A storefront sale keeps
  // `status: SOLD_FINAL` from payment through delivery, so the sold check below
  // would otherwise catch a piece that is merely in transit and call it
  // DELIVERED. This used to be masked because settlement flipped the status to
  // ADVANCE_PAID on dispatch; it no longer does (see src/lib/escrowSettle.ts),
  // and dispatch is now actually reachable, so the ordering has to carry it.
  if (item.dispatchedAt || item.escrowStatus === STAGE1_ADVANCE_PAID_40) return 'DISPATCHED';
  if (item.packedAt) return 'QUALITY_CHECK';

  // A sold status means delivered only when no escrow is holding the money.
  // STAGE1 and STAGE2 are handled above, so the only escrow value that can
  // reach this line is ESCROW_HELD — a verified Razorpay payment, which is the
  // START of the buyer's ladder, not the end. Items sold through the admin's
  // own sale flow carry no escrow row at all and still read as delivered.
  if (SOLD_STATUSES.has(status) && item.escrowStatus !== ESCROW_HELD) return 'DELIVERED';
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

/**
 * How long an artisan may go without posting an update before the buyer is
 * shown a staleness line and the artisan a nudge.
 *
 * Three days rather than one: a weaver working a single saree has nothing new
 * to photograph most days, and a nudge that fires every morning is one the
 * artisan learns to ignore.
 */
export const UPDATE_OVERDUE_DAYS = 3;

/**
 * True when a live order has gone quiet.
 *
 * Measured from the last log, falling back to acceptance — an order accepted
 * five days ago with no log at all is exactly as stale as one whose last update
 * was five days ago, and treating a missing `lastLogAt` as "fine" would hide
 * the worst case.
 */
export function isUpdateOverdue(order: {
  status?: string | null;
  lastLogAt?: Date | string | null;
  createdAt?: Date | string | null;
}): boolean {
  if (TERMINAL_ORDER_STATUSES.includes(String(order.status ?? ''))) return false;
  const since = order.lastLogAt ?? order.createdAt;
  if (!since) return false;
  const ms = Date.now() - new Date(since).getTime();
  return ms > UPDATE_OVERDUE_DAYS * 86_400_000;
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
