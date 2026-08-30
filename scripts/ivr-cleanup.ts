import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

/**
 * Removes the CraftItem created by scripts/ivr-dryrun.ts, so verifying the IVR
 * end to end leaves no fake craft behind in a real database. Matches only on
 * the dry-run CallSid, never on anything a real call could produce.
 */

const DRYRUN_CALL_SID_PREFIX = 'CAdryrun';

async function main() {
  const drafts = await prisma.craftItem.findMany({
    where: { ivrCallSid: { startsWith: DRYRUN_CALL_SID_PREFIX } },
    select: { id: true, craftType: true, status: true },
  });

  if (drafts.length === 0) {
    console.log('No dry-run IVR items present.');
    return;
  }

  const ids = drafts.map((d) => d.id);
  const logs = await prisma.auditLog.deleteMany({ where: { craftItemId: { in: ids } } });
  const items = await prisma.craftItem.deleteMany({ where: { id: { in: ids } } });

  console.log(`removed ${items.count} dry-run item(s) and ${logs.count} audit row(s)`);
  for (const d of drafts) console.log(`  ${d.craftType} (${d.status})`);

  const remaining = await prisma.craftItem.count({ where: { catalogMethod: 'IVR' } });
  console.log(`IVR items remaining: ${remaining}`);
}

main().finally(async () => {
  await prisma.$disconnect();
});
