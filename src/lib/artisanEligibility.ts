/**
 * Server-side glue between the DB and the pure rules engine in `./schemes`.
 *
 * Both `/api/artisan/schemes` (read) and `/api/artisan/schemes/apply` (write)
 * go through here so eligibility is computed from exactly the same context —
 * the apply endpoint re-derives it rather than trusting anything from the client.
 */

import { prisma } from '@/lib/prisma';
import type { EligibilityContext } from '@/lib/schemes';

export interface ArtisanEligibilitySnapshot {
  found: boolean;
  artisanName: string | null;
  ctx: EligibilityContext;
  profileSummary: {
    craftType: string | null;
    location: string | null;
    socialCategory: string | null;
    annualIncome: number | null;
    aadhaarLast4: string | null;
    upiId: string | null;
    clusterName: string | null;
    cooperativeId: string | null;
    hasListedItem: boolean;
    hasVerifiedItem: boolean;
  };
}

/** Load the artisan's profile + craft-item summary and build the rules context. */
export async function loadEligibilitySnapshot(
  artisanId: string
): Promise<ArtisanEligibilitySnapshot> {
  const [user, listedCount, verifiedCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: artisanId },
      include: { artisanProfile: true },
    }),
    prisma.craftItem.count({ where: { artisanId, isListedOnMarketplace: true } }),
    prisma.craftItem.count({ where: { artisanId, patchId: { not: null } } }),
  ]);

  const p = user?.artisanProfile ?? null;
  const hasListedItem = listedCount > 0;
  const hasVerifiedItem = verifiedCount > 0;

  const ctx: EligibilityContext = {
    socialCategory: p?.socialCategory ?? null,
    annualIncome: p?.annualIncome ?? null,
    craftType: p?.craftType ?? null,
    aadhaarLast4: p?.aadhaarLast4 ?? null,
    upiId: p?.upiId ?? null,
    clusterName: p?.clusterName ?? null,
    cooperativeId: p?.cooperativeId ?? null,
    hasListedItem,
    hasVerifiedItem,
  };

  return {
    found: Boolean(user),
    artisanName: user?.name ?? null,
    ctx,
    profileSummary: {
      craftType: ctx.craftType ?? null,
      location: p?.location ?? null,
      socialCategory: ctx.socialCategory ?? null,
      annualIncome: ctx.annualIncome ?? null,
      aadhaarLast4: ctx.aadhaarLast4 ?? null,
      upiId: ctx.upiId ?? null,
      clusterName: ctx.clusterName ?? null,
      cooperativeId: ctx.cooperativeId ?? null,
      hasListedItem,
      hasVerifiedItem,
    },
  };
}
