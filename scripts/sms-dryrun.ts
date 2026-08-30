import 'dotenv/config';
import twilio from 'twilio';
import { prisma } from '../src/lib/prisma';
import { toE164 } from '../src/lib/sms';

/**
 * Exercises the inbound SMS webhook exactly as Twilio would — urlencoded body,
 * real X-Twilio-Signature — without needing a phone or a paid number.
 *
 *   npx tsx scripts/sms-dryrun.ts
 *
 * Outbound sending is NOT triggered here: notifyArtisansForDemand is called
 * with sendSms:false so no real number is ever texted by a test.
 */

const BASE = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const URL_INBOUND = `${BASE}/api/sms/inbound`;

async function postSms(params: Record<string, string>, opts: { tamper?: boolean } = {}) {
  const signature = twilio.getExpectedTwilioSignature(TOKEN, URL_INBOUND, params);
  const res = await fetch(URL_INBOUND, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': opts.tamper ? 'Zm9yZ2Vkc2lnbmF0dXJlPT0=' : signature,
    },
    body: new URLSearchParams(params).toString(),
  });
  const xml = await res.text();
  const reply = xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1]?.trim() ?? '(no message)';
  return { status: res.status, reply };
}

async function main() {
  if (!TOKEN) {
    console.error('TWILIO_AUTH_TOKEN is not set — cannot sign requests.');
    process.exit(1);
  }

  // --- pick an artisan, giving them a test number if none is set ---------
  // No seeded artisan currently has a mobileNumber, so the reply path has
  // nothing to match on. A reserved test number is written here and restored
  // at the end, so a dry run never leaves a real number on a profile.
  const TEST_NUMBER = '+919999000001';

  let profile = await prisma.artisanProfile.findFirst({
    where: { mobileNumber: { not: null } },
    select: { mobileNumber: true, craftType: true, user: { select: { id: true, name: true } } },
  });

  let restoreProfileUserId: string | null = null;

  if (!profile?.mobileNumber) {
    const candidate = await prisma.artisanProfile.findFirst({
      select: { userId: true, craftType: true, user: { select: { id: true, name: true } } },
    });
    if (!candidate) {
      console.error('No artisan profiles at all; cannot test the reply path.');
      return;
    }
    await prisma.artisanProfile.update({
      where: { userId: candidate.userId },
      data: { mobileNumber: TEST_NUMBER },
    });
    restoreProfileUserId = candidate.userId;
    profile = { mobileNumber: TEST_NUMBER, craftType: candidate.craftType, user: candidate.user };
    console.log(`(temporarily set ${TEST_NUMBER} on ${candidate.user.name} for this test)`);
  }

  const from = toE164(profile.mobileNumber);
  console.log(`artisan: ${profile.user.name} (${profile.craftType}) -> ${from}`);

  // Park this artisan's existing pending alerts for the duration of the run.
  // Without this, the "nothing left to accept" check finds a REAL seeded alert
  // and accepts it — which also advances a real Demand to MATCHED.
  const parked = await prisma.notification.findMany({
    where: { userId: profile.user.id, type: 'DEMAND_ALERT', read: false },
    select: { id: true },
  });
  if (parked.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: parked.map((p) => p.id) } },
      data: { read: true },
    });
    console.log(`(parked ${parked.length} existing alert(s) so the test cannot consume them)`);
  }

  // --- give them a pending DEMAND_ALERT to answer ------------------------
  const demand = await prisma.demand.create({
    data: {
      craftType: profile.craftType,
      quantity: 40,
      targetPriceMin: 2000,
      targetPriceMax: 2600,
      location: 'Jaipur',
      buyerName: 'SMS Dryrun Buyer',
      notes: 'sms-dryrun',
      status: 'OPEN',
    },
  });

  const alert = await prisma.notification.create({
    data: {
      userId: profile.user.id,
      type: 'DEMAND_ALERT',
      title: `Demand spike: ${profile.craftType}`,
      message: `SMS Dryrun Buyer wants 40 ${profile.craftType}. Reply 1 to accept.`,
      relatedDemandId: demand.id,
      channel: 'SMS',
      outboundSid: 'SMdryrun0000000000000000000000001',
    },
  });
  console.log(`seeded demand ${demand.id} + alert ${alert.id}`);

  // --- the checks --------------------------------------------------------
  console.log('\n1. tampered signature');
  console.log('  ', await postSms({ From: from!, Body: '1', MessageSid: 'SMt' }, { tamper: true }));

  console.log('\n2. unknown number');
  console.log('  ', await postSms({ From: '+15550009999', Body: '1', MessageSid: 'SMu' }));

  console.log('\n3. gibberish -> help');
  console.log('  ', await postSms({ From: from!, Body: 'hello there', MessageSid: 'SMh' }));

  console.log('\n4. accept with "1"');
  console.log('  ', await postSms({ From: from!, Body: '1', MessageSid: 'SMa' }));

  const afterAccept = await prisma.notification.findUnique({ where: { id: alert.id } });
  const demandAfter = await prisma.demand.findUnique({ where: { id: demand.id } });
  console.log(
    `   DB -> accepted=${afterAccept?.accepted} acceptedAt=${afterAccept?.acceptedAt ? 'set' : 'null'} read=${afterAccept?.read} demand.status=${demandAfter?.status}`
  );

  console.log('\n5. accept again with nothing pending');
  console.log('  ', await postSms({ From: from!, Body: '1', MessageSid: 'SMa2' }));

  // --- decline path on a second alert ------------------------------------
  const alert2 = await prisma.notification.create({
    data: {
      userId: profile.user.id,
      type: 'DEMAND_ALERT',
      title: `Demand spike: ${profile.craftType}`,
      message: 'Second dry-run alert. Reply 2 to skip.',
      relatedDemandId: demand.id,
      channel: 'SMS',
    },
  });

  console.log('\n6. decline with "2"');
  console.log('  ', await postSms({ From: from!, Body: '2', MessageSid: 'SMd' }));
  const afterDecline = await prisma.notification.findUnique({ where: { id: alert2.id } });
  console.log(`   DB -> accepted=${afterDecline?.accepted} read=${afterDecline?.read}`);

  // --- clean up ----------------------------------------------------------
  await prisma.notification.deleteMany({ where: { id: { in: [alert.id, alert2.id] } } });
  await prisma.demand.delete({ where: { id: demand.id } });
  if (parked.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: parked.map((p) => p.id) } },
      data: { read: false },
    });
    console.log(`un-parked ${parked.length} existing alert(s).`);
  }
  if (restoreProfileUserId) {
    await prisma.artisanProfile.update({
      where: { userId: restoreProfileUserId },
      data: { mobileNumber: null },
    });
    console.log('restored the artisan mobileNumber to null.');
  }
  console.log('cleaned up dry-run demand and alerts.');
}

main()
  .catch((e) => {
    console.error('sms dry run failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
