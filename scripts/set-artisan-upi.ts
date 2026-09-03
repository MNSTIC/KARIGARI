import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

/**
 * Points every artisan payout VPA at a single demo UPI ID.
 *
 * The seeded artisans are dummy accounts, so their per-artisan VPAs never
 * resolve to a real bank. For a live demo the money has to land somewhere that
 * can actually be checked, which is what this collapses them to.
 *
 * Two things carry the VPA:
 *   - `ArtisanProfile.upiId`         — the artisan's payout account.
 *   - `CraftItem.artisanUpiDestination` — a snapshot taken at checkout, which
 *     is what settle-escrow actually pays out to. Rows already holding a
 *     snapshot are repointed too, otherwise pending tranches would still
 *     target the old dummy VPAs.
 *
 * Idempotent: re-running it changes nothing once every row matches.
 *
 *   npx tsx scripts/set-artisan-upi.ts
 */

const UPI_ID = 'yugankrout@oksbi';

async function main() {
  // `NOT: { upiId }` alone drops rows where the column is null (SQL three-valued
  // logic), and those are exactly the profiles that most need a VPA.
  const profiles = await prisma.artisanProfile.updateMany({
    where: { OR: [{ upiId: null }, { NOT: { upiId: UPI_ID } }] },
    data: { upiId: UPI_ID },
  });

  // Only touch items that already carry a snapshot — a null destination means
  // the item was never checked out, and writing one would fake a sale.
  const items = await prisma.craftItem.updateMany({
    where: { artisanUpiDestination: { not: null }, NOT: { artisanUpiDestination: UPI_ID } },
    data: { artisanUpiDestination: UPI_ID },
  });

  const total = await prisma.artisanProfile.count();

  console.log(`UPI ID set to ${UPI_ID}`);
  console.log(`  artisan profiles updated: ${profiles.count} (of ${total} total)`);
  console.log(`  escrow destinations repointed: ${items.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
