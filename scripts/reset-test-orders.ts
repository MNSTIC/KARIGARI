import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

/**
 * Undo the smoke-test purchases made while wiring up Razorpay.
 *
 * The verification pass had to book real orders to prove the flow end to end,
 * so three seeded pieces now carry a payment id beginning `pay_TEST`. They make
 * the My Orders tab show something on a fresh clone, which is useful for a
 * demo — but they also count towards the artisans' earnings, so this exists to
 * take them back out when that matters.
 *
 * Only rows whose payment id starts with `pay_TEST` are touched. A real
 * Razorpay payment id never has that prefix, so a genuine sale is safe from
 * this script.
 *
 *   npx tsx scripts/reset-test-orders.ts          # list what would be reset
 *   npx tsx scripts/reset-test-orders.ts --apply  # actually reset it
 */

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.craftItem.findMany({
    where: { razorpayPaymentId: { startsWith: 'pay_TEST' } },
    select: {
      id: true,
      craftType: true,
      status: true,
      escrowStatus: true,
      salePrice: true,
      advancePaid: true,
      finalPayoutQueued: true,
      relatedDemandId: true,
    },
  });

  if (rows.length === 0) {
    console.log('No smoke-test orders found.');
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.id}  ${row.craftType}  status=${row.status} escrow=${row.escrowStatus} ` +
        `sale=${row.salePrice} advance=${row.advancePaid} final=${row.finalPayoutQueued}`
    );
  }

  if (!APPLY) {
    console.log(`\n${rows.length} order(s) would be reset. Re-run with --apply.`);
    return;
  }

  // Demands these purchases advanced. Reverted only when nothing else paid for
  // them — another buyer's real order must not be walked back to OPEN.
  const demandIds = Array.from(
    new Set(rows.map((row) => row.relatedDemandId).filter((id): id is string => Boolean(id)))
  );

  await prisma.craftItem.updateMany({
    where: { razorpayPaymentId: { startsWith: 'pay_TEST' } },
    data: {
      razorpayOrderId: null,
      razorpayPaymentId: null,
      razorpaySignature: null,
      paidAt: null,
      paidAmountPaise: null,
      buyerName: null,
      buyerContact: null,
      relatedDemandId: null,
      escrowStatus: null,
      advanceAmount: null,
      finalSettlementAmount: null,
      artisanUpiDestination: null,
      advancePaid: 0,
      finalPayoutQueued: 0,
      salePrice: null,
      productionStage: null,
      status: 'PENDING_VERIFICATION',
    },
  });

  for (const demandId of demandIds) {
    const stillPaid = await prisma.craftItem.count({
      where: { relatedDemandId: demandId, paidAt: { not: null } },
    });
    if (stillPaid === 0) {
      await prisma.demand.update({ where: { id: demandId }, data: { status: 'OPEN' } });
      console.log(`demand ${demandId} -> OPEN`);
    }
  }

  // The audit trail is deliberately NOT deleted: it is append-only by design,
  // and a log saying a test payment happened is true.
  console.log(`\nReset ${rows.length} order(s). Audit entries left in place.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
