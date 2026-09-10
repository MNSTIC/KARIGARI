import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { formatRupees } from '@/lib/pricing';

/**
 * The one writer for `BuyerNotification`.
 *
 * Buyers have no account in KARIGARI — the storefront and the demand board are
 * both unauthenticated — so every alert here is addressed to the same free-text
 * name the demand was posted under. That is why this is a separate model from
 * the artisan `Notification` and why it has no `userId`: see the note on the
 * model in prisma/schema.prisma.
 *
 * Every call is best-effort. A buyer alert is worth writing, but a demand post,
 * an acceptance, a verified payment or a delivery credit must never fail
 * because a notification row could not be created — exactly the rule the demand
 * SMS fan-out already follows. Nothing in this file throws; failures return
 * false and log.
 */

/** The prisma client, or a transaction client, whichever the caller has. */
export type PrismaLike =
  | PrismaClient
  | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type BuyerNotificationType =
  | 'DEMAND_MATCHED'
  | 'ORDER_ACCEPTED'
  | 'DAILY_UPDATE'
  | 'ORDER_READY'
  | 'ORDER_PACKED'
  | 'ORDER_DISPATCHED'
  | 'ORDER_DELIVERED'
  | 'PURCHASE_CONFIRMED';

export interface CreateBuyerNotificationInput {
  /** Free text. A demand posted anonymously has none, and gets no alerts. */
  buyerName?: string | null;
  demandId: string;
  artisanOrderId?: string | null;
  type: BuyerNotificationType;
  title: string;
  message: string;
  /** Pass a transaction client to write inside the caller's transaction. */
  client?: PrismaLike;
}

/**
 * Midnight tonight, in IST, as a UTC instant.
 *
 * India has no daylight saving, so a fixed +5:30 offset is exact rather than an
 * approximation — which is what lets the daily-update throttle be a plain
 * timestamp comparison instead of a timezone library.
 */
const IST_OFFSET_MS = 5.5 * 3_600_000;

export function startOfTodayIST(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/**
 * Write one buyer alert.
 *
 * Returns true when a row was created, false when it was skipped (no buyer
 * name, throttled) or failed. Callers use the return value for logging only —
 * none of them may treat false as an error.
 */
export async function createBuyerNotification(
  input: CreateBuyerNotificationInput
): Promise<boolean> {
  const buyerName = (input.buyerName ?? '').trim();
  // An anonymous demand has nobody to notify. Not a failure — the board
  // deliberately allows a post without a name.
  if (!buyerName) return false;

  const db = input.client ?? defaultPrisma;

  try {
    // A talkative artisan posting four updates in an afternoon should not send
    // the buyer four pings. The OrderLog rows are all still written — only the
    // alert is throttled, so the artisan's record of their own work is intact.
    if (input.type === 'DAILY_UPDATE' && input.artisanOrderId) {
      const alreadyToday = await db.buyerNotification.findFirst({
        where: {
          artisanOrderId: input.artisanOrderId,
          type: 'DAILY_UPDATE',
          createdAt: { gte: startOfTodayIST() },
        },
        select: { id: true },
      });
      if (alreadyToday) return false;
    }

    await db.buyerNotification.create({
      data: {
        buyerName,
        demandId: input.demandId,
        artisanOrderId: input.artisanOrderId ?? null,
        type: input.type,
        title: input.title.slice(0, 200),
        message: input.message.slice(0, 1000),
      },
    });
    return true;
  } catch (error) {
    // Deliberately swallowed: see the note at the top of this file.
    console.error(
      `[buyerNotify] could not write ${input.type} for demand ${input.demandId}:`,
      (error as Error)?.message
    );
    return false;
  }
}

/**
 * The copy for each event, in one place.
 *
 * Written here rather than at the call sites so the eight messages read as one
 * voice, and so the demo-charge rule is enforced once: every amount below is
 * an agreed or displayed price passed in by the caller. `paidAmountPaise` must
 * never reach this file.
 */
export const buyerNotificationCopy = {
  demandMatched: (craftType: string, count: number) => ({
    title: 'Your request reached artisans',
    message: `${count} artisan${count === 1 ? '' : 's'} who work in ${craftType} have been alerted. You will hear here as soon as one accepts.`,
  }),
  orderAccepted: (artisanName: string, quantity: number, craftType: string, price: number | null, deadline: Date | null) => ({
    title: `${artisanName} accepted your request`,
    message:
      `${artisanName} has taken on ${quantity} × ${craftType}` +
      (price ? ` at ${formatRupees(price)} per piece` : '') +
      (deadline
        ? `, due ${deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}.`
        : '.'),
  }),
  dailyUpdate: (artisanName: string, note: string | null) => ({
    title: `${artisanName} posted an update`,
    message: note?.trim() ? note.trim().slice(0, 300) : 'A new progress photo is on your order.',
  }),
  orderReady: (artisanName: string, score: number, scoredBy: 'gemini' | 'fallback') => ({
    title: 'Your piece is finished',
    message:
      `${artisanName} scanned the piece's own QR patch and photographed it finished. ` +
      (scoredBy === 'gemini'
        ? `The AI matched it to the original capture at ${score}%.`
        : 'The AI check could not run just now, so this was recorded without a comparison score.'),
  }),
  orderPacked: (artisanName: string) => ({
    title: 'Your order is packed',
    message: `${artisanName} has packed your order and is arranging dispatch.`,
  }),
  orderDispatched: (artisanName: string, courierName: string | null, trackingRef: string | null) => ({
    title: 'Your order has been dispatched',
    message:
      `${artisanName} has handed your order over` +
      (courierName ? ` to ${courierName}` : '') +
      (trackingRef ? `. Tracking reference: ${trackingRef}.` : '.'),
  }),
  orderDelivered: (craftType: string, credited: number) => ({
    title: 'Delivery confirmed',
    message:
      credited > 0
        ? `Thank you. Your ${craftType} order is closed and ${formatRupees(credited)} has been credited to the artisan at the agreed price.`
        : `Thank you. Your ${craftType} order is closed.`,
  }),
  purchaseConfirmed: (craftType: string, artisanName: string, displayPrice: number | null) => ({
    title: 'Payment confirmed',
    message:
      `Your purchase of ${craftType} from ${artisanName} is confirmed` +
      (displayPrice ? ` at ${formatRupees(displayPrice)}` : '') +
      '. The artisan has been told to pack and dispatch it.',
  }),
};
