import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { buildDemandSms, toE164 } from '../src/lib/sms';
import { notifyArtisansForDemand } from '../src/lib/notifications';

/**
 * Checks the outbound half without texting anybody.
 *
 * SMS_ALLOWLIST is forced to a number no artisan holds, so sendSms takes its
 * skip path: the matching, the message text and the notification rows are all
 * exercised, but nothing leaves Twilio.
 */
process.env.SMS_ALLOWLIST = '+910000000000';

async function main() {
  console.log('--- toE164 normalisation ---');
  for (const raw of ['9876543210', '+91 98765 43210', '09876543210', '919876543210', 'not a number', '']) {
    console.log(`  ${JSON.stringify(raw).padEnd(20)} -> ${toE164(raw) ?? 'null (skipped)'}`);
  }

  console.log('\n--- SMS body ---');
  const body = buildDemandSms({
    buyerName: 'Aarohi Exports',
    quantity: 50,
    craftType: 'Sonepuri Silk',
    location: 'Delhi',
    priceLabel: 'Rs 3,200-3,800',
  });
  console.log(`  "${body}"`);
  console.log(`  ${body.length} chars (${body.length <= 160 ? 'single segment' : 'MULTI-SEGMENT'})`);

  console.log('\n--- fan-out on a real matching demand (allowlist blocks sending) ---');
  const demand = await prisma.demand.create({
    data: {
      craftType: 'Sonepuri Silk',
      quantity: 50,
      targetPriceMin: 3200,
      targetPriceMax: 3800,
      location: 'Delhi',
      buyerName: 'Outbound Check Buyer',
      status: 'OPEN',
    },
  });

  const result = await notifyArtisansForDemand(demand);
  console.log(`  created=${result.created} smsSent=${result.smsSent} (smsSent must be 0)`);

  const rows = await prisma.notification.findMany({
    where: { relatedDemandId: demand.id },
    select: { channel: true, outboundSid: true, user: { select: { name: true } } },
  });
  for (const r of rows) {
    console.log(`    ${r.user.name} channel=${r.channel} outboundSid=${r.outboundSid ?? 'null'}`);
  }

  // Idempotency: a second fan-out for the same demand must add nothing.
  const again = await notifyArtisansForDemand(demand);
  console.log(`  re-run -> created=${again.created} smsSent=${again.smsSent} (both must be 0)`);

  await prisma.notification.deleteMany({ where: { relatedDemandId: demand.id } });
  await prisma.demand.delete({ where: { id: demand.id } });
  console.log('\ncleaned up.');
}

main()
  .catch((e) => {
    console.error('outbound check failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
