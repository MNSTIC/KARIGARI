/**
 * Step-by-step guidance for getting a craft onto GeM and ONDC.
 *
 * Deterministic by design — no model call. This is the one part of the export
 * an artisan actually reads and acts on, so it has to render identically every
 * time and keep working when every AI key is unset or rate-limited.
 *
 * Every figure below is a published government fact, not an estimate:
 *   - GeM onboarding (Aadhaar + PAN + Udyam), Catalogue Management:
 *     https://gem.gov.in/landing/index/Catalogue_Management
 *   - 25% MSE procurement target with a 4% sub-target for SC/ST-owned MSEs and
 *     3% for women-owned (Womaniya), SARAS Collection, Startup Runway:
 *     https://gem.gov.in
 *
 * KARIGARI does not submit anything to GeM; these are instructions the artisan
 * follows on the official portal.
 */

import { qualifiesForWomaniya } from '@/lib/gender';

export type PreferenceKey = 'sc_st' | 'womaniya' | 'msme';

export interface GuidanceStep {
  /** 1-based, so the UI does not have to re-derive ordering. */
  number: number;
  title: string;
  detail: string;
}

export interface GemGuidance {
  title: string;
  /** The headline preference, used for the title. */
  preference: PreferenceKey;
  preferenceLabel: string;
  preferenceDetail: string;
  /**
   * Every preference this artisan qualifies for. The SC/ST (4%) and Womaniya
   * (3%) sub-targets are separate reservations, so a woman from a Scheduled
   * Caste can claim both — collapsing them to one would quietly cost her a
   * channel she is entitled to.
   */
  preferences: { key: PreferenceKey; label: string; detail: string }[];
  steps: GuidanceStep[];
  /** Shown verbatim in the UI — the feature must not imply a submission. */
  disclaimer: string;
}

export interface GuidanceProfile {
  socialCategory?: string | null;
  gender?: string | null;
  clusterName?: string | null;
  location?: string | null;
  giTagName?: string | null;
}

const PREFERENCES: Record<PreferenceKey, { label: string; detail: string; qualifier: string }> = {
  sc_st: {
    label: 'SC/ST artisan quota',
    detail:
      'SC/ST-owned micro and small enterprises have a 4% procurement sub-target, inside the wider 25% MSE target for government buyers.',
    qualifier: 'the SC/ST artisan quota',
  },
  womaniya: {
    label: 'Womaniya (women-owned)',
    detail:
      'Women-owned micro and small enterprises have a 3% procurement sub-target, inside the wider 25% MSE target. GeM lists them under the Womaniya storefront.',
    qualifier: 'Womaniya, the women-artisan channel',
  },
  msme: {
    label: 'MSME seller',
    detail:
      'Micro and small enterprises have a 25% procurement target from government buyers. Register on Udyam to be counted.',
    qualifier: 'the MSME seller route',
  },
};

/**
 * Every reservation this artisan can actually claim.
 *
 * SC/ST (4%) and Womaniya (3%) are distinct sub-targets of the same 25% MSE
 * procurement target, so they stack. Only SC and ST map to the caste
 * sub-target — OBC, EWS and General do not, and are not told otherwise.
 * MSME is the floor everyone stands on, and is listed when nothing narrower
 * applies so the guide never comes back empty.
 */
function preferencesFor(profile?: GuidanceProfile | null): PreferenceKey[] {
  const category = (profile?.socialCategory ?? '').trim().toUpperCase();
  const keys: PreferenceKey[] = [];

  if (category === 'SC' || category === 'ST') keys.push('sc_st');
  if (qualifiesForWomaniya(profile?.gender)) keys.push('womaniya');
  if (keys.length === 0) keys.push('msme');

  return keys;
}

export function buildGemGuidance(
  profile: GuidanceProfile | null | undefined,
  craftType: string
): GemGuidance {
  const craft = (craftType || '').trim() || 'your craft';
  const keys = preferencesFor(profile);
  const preference = keys[0];
  const pref = PREFERENCES[preference];
  const applicable = keys.map((key) => ({
    key,
    label: PREFERENCES[key].label,
    detail: PREFERENCES[key].detail,
  }));
  const isCluster = Boolean(profile?.clusterName?.trim());

  const steps: GuidanceStep[] = [
    {
      number: 1,
      title: 'Register as a seller on gem.gov.in',
      detail:
        'Use your Aadhaar and PAN, plus your Udyam (MSME) registration. GSTIN only if it applies — handloom and khadi are often exempt. Entirely online.',
    },
    {
      number: 2,
      title: 'Complete your seller profile and bank details',
      detail:
        'Add the bank account that will receive payments. Government buyers pay into this account directly, with no middleman.',
    },
    {
      number: 3,
      title: 'Upload this catalog under Handloom & Handicrafts',
      detail: isCluster
        ? `Use the CSV from this export. As a ${profile?.clusterName} member, list through the SARAS Collection channel for rural artisan and SHG products.`
        : 'Use the CSV from this export. Rural artisan and SHG products can also be listed through the SARAS Collection channel.',
    },
    {
      number: 4,
      title: 'Confirm the HSN code and GST rate',
      detail:
        'The codes in this file are indicative only. Check each one on the GeM portal before publishing — you are liable for the tax you file.',
    },
    {
      number: 5,
      title: 'Add high-resolution photographs',
      detail:
        'GeM expects at least 1000x1000 pixels per image. Photograph in daylight against a plain background.',
    },
    {
      number: 6,
      title:
        applicable.length > 1
          ? `Claim both your purchase preferences: ${applicable.map((p) => p.label).join(' + ')}`
          : `Claim your purchase preference: ${pref.label}`,
      detail: applicable.map((p) => p.detail).join(' '),
    },
    {
      number: 7,
      title: 'Onboard to ONDC with the Beckn payload',
      detail:
        'Take the ONDC JSON from this export to any ONDC Seller App to be listed across the open network.',
    },
    {
      number: 8,
      title: 'Consider Flipkart Samarth as well',
      detail:
        'Samarth onboards weavers and artisans onto Flipkart with dedicated support, alongside your government listings.',
    },
  ];

  if (profile?.giTagName?.trim()) {
    steps.splice(4, 0, {
      number: 0, // renumbered below
      title: `Attach your ${profile.giTagName} GI documentation`,
      detail:
        'A registered GI tag is a verifiable mark of origin and supports a higher listed price. Upload the certificate with the product.',
    });
  }

  return {
    title: `How to submit your ${craft} to GeM under ${pref.qualifier}`,
    preference,
    preferenceLabel: pref.label,
    preferenceDetail: pref.detail,
    preferences: applicable,
    steps: steps.map((step, index) => ({ ...step, number: index + 1 })),
    disclaimer:
      'KARIGARI prepares these files for you. It does not submit anything to GeM or ONDC — you upload them yourself on the official portal.',
  };
}
