import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { notifyArtisansForDemand } from '../src/lib/notifications';

/**
 * Additive seeder for the buyer demand board.
 *
 * Unlike `prisma/seed.ts`, this deletes nothing — it is safe to run against a
 * database that already holds real artisans and craft items. Demands are built
 * from the craft types that actually exist in this database, so the insights
 * matcher, the map pins and the notification writer all have something real to
 * work with. Notifications are written by the app's own notification engine
 * rather than fabricated, so a seeded alert is the same row the bell renders.
 */

const CITIES: { location: string; festival: string | null }[] = [
  { location: 'Delhi', festival: 'Diwali' },
  { location: 'Mumbai', festival: null },
  { location: 'Bengaluru', festival: 'Diwali' },
  { location: 'Hyderabad', festival: null },
  { location: 'Kolkata', festival: 'Durga Puja' },
];

const BUYERS = [
  'Aarohi Exports',
  'Setu Handloom Collective',
  'Nirvaan Retail',
  'Kalaa Bazaar',
  'Tvarit Trading Co.',
];

const QUANTITIES = [50, 120, 30, 80, 45];
const PRICE_MIN = [3200, 2400, 5200, 1800, 3600];
const PRICE_MAX = [3800, 2900, 6100, 2300, 4200];

async function main() {
  const existing = await prisma.demand.count();
  if (existing > 0) {
    console.log(`Demand board already has ${existing} row(s) — nothing to do.`);
    return;
  }

  const profiles = await prisma.artisanProfile.findMany({
    select: { craftType: true },
  });

  const crafts = Array.from(
    new Set(profiles.map((p) => p.craftType).filter((c): c is string => Boolean(c)))
  ).slice(0, 5);

  if (crafts.length === 0) {
    console.log('No artisan profiles in this database — cannot build matching demands.');
    return;
  }

  const rows = crafts.map((craftType, i) => ({
    craftType,
    quantity: QUANTITIES[i % QUANTITIES.length],
    targetPriceMin: PRICE_MIN[i % PRICE_MIN.length],
    targetPriceMax: PRICE_MAX[i % PRICE_MAX.length],
    location: CITIES[i % CITIES.length].location,
    festival: CITIES[i % CITIES.length].festival,
    buyerName: BUYERS[i % BUYERS.length],
    notes: 'Bulk requirement posted on the KARIGARI demand board.',
    status: 'OPEN',
  }));

  await prisma.demand.createMany({ data: rows });
  console.log(`Seeded ${rows.length} open demand(s) for: ${crafts.join(', ')}`);

  // Let the real engine write the alerts, so the bell and the WhatsApp
  // simulation replay genuine rows rather than hand-written copy.
  const created = await prisma.demand.findMany({ where: { status: 'OPEN' } });
  let notifications = 0;
  for (const demand of created) {
    // sendSms: false — seeding a demo board must never text real artisans.
    notifications += (await notifyArtisansForDemand(demand, { sendSms: false })).created;
  }
  console.log(`Notification engine wrote ${notifications} alert(s).`);
}

main()
  .catch((e) => {
    console.error('Demand board seed failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
