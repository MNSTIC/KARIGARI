import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { GENDERS, type Gender } from '../src/lib/gender';

/**
 * One-time backfill of `ArtisanProfile.gender` for the seeded demo accounts.
 *
 * Gender is required at registration from now on, but the existing rows are
 * dummy data with no real person behind them, so assigning one is a display
 * concern rather than a claim about anybody. Only rows where gender is still
 * null are touched, so a value an artisan actually chose is never overwritten.
 *
 * Assignment is deterministic (seeded by user id), not random, so re-running
 * this cannot reshuffle who qualifies for Womaniya between demo runs.
 *
 *   npx tsx scripts/backfill-gender.ts
 */

/** FNV-1a: small, stable, and dependency-free. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Weighted so the demo has a solid majority of women artisans — which matches
 * the handloom sector, where women are most of the workforce, and means the
 * Womaniya path is actually exercised.
 */
const DISTRIBUTION: Gender[] = ['FEMALE', 'FEMALE', 'FEMALE', 'MALE', 'MALE', 'OTHER'];

/**
 * Fixed genders for the seeded demo personas.
 *
 * These accounts are walked through on screen by name, so a hash that hands
 * "Lakshmi Devi" a different gender than her persona reads as a bug to anyone
 * watching. This is a lookup for known fixtures, not name-based inference —
 * real accounts are never guessed at, they are asked at registration.
 */
const DEMO_PERSONAS: Record<string, Gender> = {
  'lakshmi@karigari.com': 'FEMALE',
  'sunita@karigari.com': 'FEMALE',
  'anita@karigari.com': 'FEMALE',
  'devi@karigari.com': 'MALE', // Devi Prasad
  'ramesh@karigari.com': 'MALE',
  'mohan@karigari.com': 'MALE',
};

async function main() {
  // Personas are corrected even if a previous run already set them; everything
  // else is only filled when still null, so a real choice is never overwritten.
  const personaEmails = Object.keys(DEMO_PERSONAS);
  const profiles = await prisma.artisanProfile.findMany({
    where: { OR: [{ gender: null }, { user: { email: { in: personaEmails } } }] },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
  });

  if (profiles.length === 0) {
    console.log('Every artisan profile already has a gender — nothing to backfill.');
  } else {
    for (const profile of profiles) {
      const gender =
        DEMO_PERSONAS[profile.user.email] ?? DISTRIBUTION[hash(profile.userId) % DISTRIBUTION.length];
      await prisma.artisanProfile.update({ where: { id: profile.id }, data: { gender } });
      console.log(`  ${profile.user.name.padEnd(20)} -> ${gender}`);
    }
    console.log(`backfilled ${profiles.length} profile(s)`);
  }

  const counts = await prisma.artisanProfile.groupBy({ by: ['gender'], _count: true });
  console.log('distribution:', JSON.stringify(counts));

  const womaniya = await prisma.artisanProfile.count({
    where: { gender: 'FEMALE', user: { role: 'ARTISAN' } },
  });
  console.log(`${womaniya} artisan(s) now qualify for Womaniya (of ${GENDERS.length} possible values)`);
}

main().finally(async () => {
  await prisma.$disconnect();
});
