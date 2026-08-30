import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { resolveLegacySchemeKey } from '../src/lib/schemes';

/**
 * One-time backfill of `SchemeApplication.schemeKey`.
 *
 * Rows created before the `schemeKey` column existed carry only `schemeName`,
 * so every read of them falls back to `resolveLegacySchemeKey` — fuzzy matching
 * on a display string that is also the thing most likely to be reworded. This
 * resolves each row once and stores the stable key, so the tracker joins on an
 * identifier instead of a name.
 *
 * Safe to re-run: it only touches rows where `schemeKey` is still null, and it
 * skips any row whose name it cannot resolve rather than guessing.
 */

async function main() {
  const rows = await prisma.schemeApplication.findMany({
    where: { schemeKey: null },
    select: { id: true, schemeName: true },
  });

  if (rows.length === 0) {
    console.log('No rows need backfilling.');
    return;
  }

  let filled = 0;
  const unresolved: string[] = [];

  for (const row of rows) {
    const key = resolveLegacySchemeKey(row.schemeName);
    if (!key) {
      unresolved.push(row.schemeName);
      continue;
    }
    await prisma.schemeApplication.update({
      where: { id: row.id },
      data: { schemeKey: key },
    });
    filled += 1;
  }

  console.log(`backfilled ${filled} of ${rows.length} row(s)`);
  if (unresolved.length) {
    console.log('left alone (name did not resolve):', unresolved.join(', '));
  }

  const after = await prisma.schemeApplication.findMany({
    select: { schemeKey: true, status: true, user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of after) {
    console.log(`  ${r.user.email} ${r.schemeKey ?? 'NULL'} ${r.status}`);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
