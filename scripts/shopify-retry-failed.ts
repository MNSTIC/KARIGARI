/**
 * Re-run failed Shopify publishes in bulk.
 *
 *     npx tsx --env-file=.env scripts/shopify-retry-failed.ts                 # dry run: lists what would be retried
 *     npx tsx --env-file=.env scripts/shopify-retry-failed.ts --apply         # retries against http://localhost:3000
 *     npx tsx --env-file=.env scripts/shopify-retry-failed.ts --apply --base https://your-deployment
 *
 * WHY IT CALLS THE ROUTE instead of src/lib/shopify.ts directly: the publish
 * route owns the claim, the sale-rule refusals, the FAILED/LIVE bookkeeping and
 * the audit row. A second copy of that logic here would drift from it. Each
 * piece is replayed through POST /api/artisan/shopify/publish as its own
 * artisan, using a 5-minute session signed with JWT_SECRET — so this is an
 * OPERATOR tool: whoever runs it holds the signing secret already. The audit
 * rows it produces name the artisan, because the publish is theirs.
 *
 * Serial, with a pause between pieces, so a bulk retry does not itself trip
 * Shopify's rate limit. Picks up FAILED rows and PUBLISHING claims older than
 * the route's 3-minute takeover window; never touches LIVE or WITHDRAWN.
 */

import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma';

const STALE_CLAIM_MS = 3 * 60_000;
const PAUSE_MS = 1_500;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const baseIndex = args.indexOf('--base');
const base = (baseIndex >= 0 ? args[baseIndex + 1] : 'http://localhost:3000').replace(/\/+$/, '');

async function main() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set; run with --env-file=.env');

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const rows = await prisma.craftItem.findMany({
    where: {
      OR: [
        { shopifyStatus: 'FAILED' },
        { shopifyStatus: 'PUBLISHING', OR: [{ shopifyStatusAt: null }, { shopifyStatusAt: { lt: staleBefore } }] },
      ],
    },
    select: { id: true, artisanId: true, craftType: true, shopifyStatus: true, shopifySyncError: true },
    orderBy: { shopifyStatusAt: 'asc' },
  });

  console.log(`${rows.length} piece(s) to retry${apply ? '' : ' (dry run — pass --apply to retry)'}`);
  for (const row of rows) {
    console.log(`- ${row.id}  ${row.craftType}  [${row.shopifyStatus}] ${row.shopifySyncError ?? ''}`);
  }
  if (!apply || rows.length === 0) return;

  const tally: Record<string, number> = {};
  for (const row of rows) {
    const token = jwt.sign({ userId: row.artisanId, role: 'ARTISAN' }, secret, { expiresIn: '5m' });
    try {
      const res = await fetch(`${base}/api/artisan/shopify/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `auth-token=${token}` },
        body: JSON.stringify({ craftItemId: row.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      const outcome = res.ok ? 'LIVE' : `${res.status} ${body.status ?? ''}`.trim();
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      console.log(`  ${row.id} → ${outcome}${body.error ? ` — ${body.error}` : ''}`);
    } catch (error) {
      tally.unreachable = (tally.unreachable ?? 0) + 1;
      console.log(`  ${row.id} → could not reach ${base}: ${(error as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  console.log('summary:', tally);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
