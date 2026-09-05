/**
 * Exhaustive stage-resolution test.
 *
 * `resolveStage` is read by three surfaces (buyer My Orders, the public demand
 * tracker, the artisan market list) and a combination that fell through to
 * `undefined` would render an empty timeline rather than an error — invisible
 * in manual testing. So every combination of the four inputs is asserted here,
 * not a hand-picked sample.
 *
 * Plain Node, no test framework: this repo has none, and adding one for a
 * single pure function would be a heavier dependency than the test it runs.
 *   node src/lib/__tests__/orderStage.test.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

// Compile the real module to plain ESM in a temp dir, so this test always runs
// against src/lib/orderStage.ts itself rather than a copy that could drift —
// and leaves no build artifact behind in the repo. esbuild's JS API is used
// rather than the CLI because spawning `npx.cmd` is not portable on Windows.
const outDir = mkdtempSync(path.join(tmpdir(), 'karigari-orderstage-'));
const outFile = path.join(outDir, 'orderStage.mjs');
await esbuild.build({
  entryPoints: ['src/lib/orderStage.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'error',
});
const { ORDER_STAGES, resolveStage, stageIndex } = await import(pathToFileURL(outFile).href);

const STATUSES = [null, 'Pending', 'DRAFT_IVR', 'VERIFIED', 'SELLABLE', 'SOLD_FINAL', 'PAYOUT_COMPLETED', 'FLAGGED'];
const ESCROWS = [null, 'ESCROW_HELD', 'STAGE1_ADVANCE_PAID_40', 'STAGE2_SETTLED_89'];
const QR = [true, false, null];
const PROD = [null, 'ACCEPTED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'DISPATCHED', 'DELIVERED', 'NONSENSE'];

let checked = 0, fails = [];
for (const status of STATUSES)
  for (const escrowStatus of ESCROWS)
    for (const qrVerified of QR)
      for (const productionStage of PROD) {
        checked++;
        const input = { status, escrowStatus, qrVerified, productionStage };
        let stage;
        try { stage = resolveStage(input); }
        catch (e) { fails.push(`THREW ${JSON.stringify(input)}: ${e.message}`); continue; }
        if (!ORDER_STAGES.includes(stage)) {
          fails.push(`UNDEFINED STAGE ${JSON.stringify(input)} -> ${String(stage)}`);
          continue;
        }
        // Escrow settlement is the one unconditional proof of delivery.
        if (escrowStatus === 'STAGE2_SETTLED_89' && stage !== 'DELIVERED') {
          fails.push(`SETTLED-NOT-DELIVERED ${JSON.stringify(input)} -> ${stage}`);
        }
        // Advance released (and not yet settled) means the piece has shipped.
        // NOTE: a SOLD_FINAL status with escrow still HELD is deliberately NOT
        // treated as delivered — a verified Razorpay payment stamps SOLD_FINAL
        // at purchase, and reading that as "arrived" would tell the buyer their
        // piece landed before the artisan started. See derivedStage().
        if (escrowStatus === 'STAGE1_ADVANCE_PAID_40' && stageIndex(stage) < stageIndex('DISPATCHED')) {
          fails.push(`ADVANCE-REGRESSED ${JSON.stringify(input)} -> ${stage}`);
        }
        // A declared productionStage may only ever move a piece FORWARD.
        if (ORDER_STAGES.includes(productionStage)) {
          const withoutDeclared = resolveStage({ status, escrowStatus, qrVerified, productionStage: null });
          if (stageIndex(stage) < stageIndex(withoutDeclared)) {
            fails.push(`DECLARED-DRAGGED-BACK ${JSON.stringify(input)} -> ${stage}`);
          }
        }
      }

console.log(`orderStage: ${checked} combinations checked`);
if (fails.length) { console.log(`FAIL (${fails.length}):`); fails.slice(0, 12).forEach(f => console.log('  ' + f)); process.exit(1); }
console.log('PASS — every combination resolves to a defined stage and never regresses');
