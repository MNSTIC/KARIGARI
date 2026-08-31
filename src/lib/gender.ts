/**
 * Gender vocabulary for the artisan profile.
 *
 * Stored because GeM's Womaniya channel reserves a 3% procurement sub-target
 * for women-owned enterprises, and the app cannot tell an artisan they qualify
 * without knowing. It is used for that eligibility and nothing else.
 *
 * `OTHER` is a first-class value, not a fallback: it is recorded faithfully and
 * simply does not map to a women-only quota.
 */

export const GENDERS = ['FEMALE', 'MALE', 'OTHER'] as const;

export type Gender = (typeof GENDERS)[number];

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value.toUpperCase());
}

/** Normalises loose input ("female", " Male ") to the stored form. */
export function normalizeGender(value: unknown): Gender | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (GENDERS as readonly string[]).includes(upper) ? (upper as Gender) : null;
}

/** Only a woman-owned enterprise can claim Womaniya. */
export function qualifiesForWomaniya(gender?: string | null): boolean {
  return normalizeGender(gender) === 'FEMALE';
}

/** Display labels, kept here so the register form and profile editor agree. */
export const GENDER_LABELS: Record<Gender, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
};
