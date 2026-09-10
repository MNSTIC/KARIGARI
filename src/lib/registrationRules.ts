import { normalizeGender, type Gender } from '@/lib/gender';

/**
 * What a KARIGARI account needs before it can exist — the ONE definition.
 *
 * Two screens now create accounts: the password form at `/register` and the
 * Google completion screen at `/register/complete`. They ask for the same six
 * artisan fields, and if each validated them separately the two would drift the
 * first time one of them gained a field. Both call this.
 *
 * The rules themselves are unchanged from what `/api/auth/register` already
 * enforced — this is where they moved to, not a new policy.
 */

export const ROLES = ['ARTISAN', 'ADMIN'] as const;
export type SignupRole = (typeof ROLES)[number];

export function isSignupRole(value: unknown): value is SignupRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** The shape both screens post. Everything optional; the rules decide. */
export interface SignupInput {
  name?: unknown;
  role?: unknown;
  craftType?: unknown;
  location?: unknown;
  experienceYears?: unknown;
  aadhaarLast4?: unknown;
  annualIncome?: unknown;
  clusterName?: unknown;
  shgGroupLink?: unknown;
  gender?: unknown;
  photoUrl?: unknown;
}

/** The normalised, validated result — safe to hand straight to Prisma. */
export interface ValidatedSignup {
  name: string;
  role: SignupRole;
  /** Null for an ADMIN: there is no profile to create. */
  artisanProfile: {
    craftType: string;
    location: string;
    experienceYears: number;
    aadhaarLast4: string;
    annualIncome: number;
    clusterName: string;
    shgGroupLink: string | null;
    gender: Gender;
    photoUrl: string | null;
  } | null;
}

export type SignupValidation =
  | { ok: true; value: ValidatedSignup }
  | { ok: false; error: string };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Validate a signup payload.
 *
 * Returns a typed result rather than throwing, so a route can turn a failure
 * into its own 400 without a try/catch around business logic.
 *
 * The error strings are the ones `/api/auth/register` already returned, so the
 * password path's behaviour does not change by one character.
 */
export function validateSignup(input: SignupInput): SignupValidation {
  const name = text(input.name, 120);
  if (!name) return { ok: false, error: 'Missing required fields' };

  if (!isSignupRole(input.role)) {
    return { ok: false, error: 'Missing required fields' };
  }
  const role = input.role;

  if (role !== 'ARTISAN') {
    return { ok: true, value: { name, role, artisanProfile: null } };
  }

  const aadhaarLast4 = text(input.aadhaarLast4, 4);
  const annualIncomeRaw = Number(input.annualIncome);
  if (!aadhaarLast4 || !Number.isFinite(annualIncomeRaw)) {
    return {
      ok: false,
      error: 'Aadhaar Last 4 and Annual Income are required for artisans',
    };
  }

  // Required from here on: without it the app cannot tell an artisan whether
  // they qualify for the women-only Womaniya sub-target on GeM.
  const gender = normalizeGender(input.gender);
  if (!gender) {
    return {
      ok: false,
      error: 'Please select a gender. It is used to check women-only scheme eligibility.',
    };
  }

  const shgGroupLink = text(input.shgGroupLink, 500);
  const photoUrl = typeof input.photoUrl === 'string' && input.photoUrl.startsWith('data:image/')
    ? input.photoUrl
    : null;

  return {
    ok: true,
    value: {
      name,
      role,
      artisanProfile: {
        // The 'Unspecified' fallbacks are inherited from the original route:
        // these two are collected by the form but have never been hard-required
        // at the API, and tightening that here would reject payloads the
        // password path accepts today.
        craftType: text(input.craftType, 120) || 'Unspecified',
        location: text(input.location, 120) || 'Unspecified',
        experienceYears: Number(input.experienceYears) || 0,
        aadhaarLast4,
        annualIncome: Number(input.annualIncome) || 0,
        clusterName: text(input.clusterName, 120) || 'Independent',
        // Optional at signup — becomes the cluster key on /artisan/cluster when
        // set, otherwise that page falls back to grouping by location.
        shgGroupLink: shgGroupLink || null,
        gender,
        // Left null when skipped, so <Avatar /> draws their initials rather than
        // a stock stranger's face.
        photoUrl,
      },
    },
  };
}
