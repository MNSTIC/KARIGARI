import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { categoryFor, marketPrice } from '@/lib/marketplace';
import { PURCHASABLE_WHERE, unpurchasableReason } from '@/lib/storefrontSale';
import type { DemandDraft } from '@/lib/demandDraft';
import {
  PASSPORT_AUDIT_ACTIONS,
  buildTimeline,
  buildTrustLayers,
  catalogTagsOf,
  colorFrom,
  demandDraftFor,
  giLabelFor,
  materialFrom,
  receivedFor,
  type FactSource,
  type ProvenanceInput,
  type ReceivedFigure,
  type SimilarityRecord,
  type TimelineStep,
  type TrustLayers,
} from '@/lib/passportFacts';

/**
 * The buyer passport for one piece — the single loader behind `/verify/[patchId]`
 * (the QR-scan page) and `/marketplace/product/[id]`.
 *
 * Built field by field from an explicit select. Before this existed the QR page
 * passed the whole CraftItem row and the whole ArtisanProfile to a client
 * component, which serialised the artisan's mobile number, UPI id, bank account
 * and Aadhaar digits, the buyer's name and contact, and every audit comment
 * into the page HTML. Nothing reaches a browser now unless it is named below.
 *
 * Photos are never inlined: a capture is a base64 data URL of a few hundred
 * kilobytes, so each is referenced through GET /api/passport/[id]/image, which
 * the browser fetches lazily. Seeded and hosted photos are already short paths
 * and go through as they are.
 */

export interface PassportImage {
  src: string;
  /** Data-backed images come through our own route and skip the optimiser. */
  unoptimized: boolean;
  /** A narrow copy for thumbnails, where one exists. */
  thumb: string;
}

export interface PassportVariant {
  key: string;
  /** i18n key, as stored (`variant_cream`). */
  labelKey: string;
  image: PassportImage;
}

export interface PassportArtisan {
  id: string;
  name: string;
  photoUrl: string | null;
  location: string | null;
  craftType: string | null;
  experienceYears: number | null;
  clusterName: string | null;
  bio: string | null;
  gi: string | null;
}

export interface PassportCard {
  id: string;
  craftType: string;
  image: PassportImage | null;
  price: number | null;
}

export interface Passport {
  id: string;
  /** Only on the QR page, which is reached through it. The marketplace keeps it private. */
  patchId: string | null;
  craftType: string;
  descriptionOriginal: string | null;
  descriptionEnglish: string | null;
  /** For the product page's meta description only. */
  aiGeneratedListing: string | null;
  catalogMethod: string | null;
  voiceLanguage: string | null;
  laborDays: number | null;
  material: { value: string; source: FactSource } | null;
  category: string;
  images: PassportImage[];
  variants: PassportVariant[];
  price: number | null;
  fairWageFloor: number | null;
  marketPriceMin: number | null;
  marketPriceMax: number | null;
  isListedOnMarketplace: boolean;
  sold: boolean;
  buyable: boolean;
  received: ReceivedFigure;
  timeline: TimelineStep[];
  trust: TrustLayers;
  artisan: PassportArtisan;
  moreFromArtisan: PassportCard[];
  demandDraft: Partial<DemandDraft>;
}

/** How many other pieces "More from this artisan" shows. */
export const MORE_FROM_ARTISAN_LIMIT = 6;
/** Thumbnail width requested from the image route. */
export const PASSPORT_THUMB_WIDTH = 240;

const PASSPORT_SELECT = {
  id: true,
  artisanId: true,
  patchId: true,
  craftType: true,
  descriptionOriginal: true,
  descriptionEnglish: true,
  aiGeneratedListing: true,
  aiSuggestedCategory: true,
  aiCatalog: true,
  tags: true,
  images: true,
  imageVariants: true,
  laborDays: true,
  catalogMethod: true,
  voiceLanguage: true,
  rawMaterialProofUrl: true,
  photoQualityScore: true,
  photoQualitySource: true,
  fairWageFloor: true,
  marketPriceMin: true,
  marketPriceMax: true,
  standardMarketPrice: true,
  askingPrice: true,
  salePrice: true,
  status: true,
  escrowStatus: true,
  isListedOnMarketplace: true,
  syndicatedAt: true,
  syndicatedChannels: true,
  shopifyPublishedAt: true,
  qrVerified: true,
  qrVerifiedAt: true,
  qrExemptAt: true,
  paidAt: true,
  packedAt: true,
  dispatchedAt: true,
  deliveredAt: true,
  advancePaid: true,
  finalPayoutQueued: true,
  payoutMode: true,
  createdAt: true,
  artisan: {
    select: {
      id: true,
      name: true,
      artisanProfile: {
        select: {
          photoUrl: true,
          location: true,
          craftType: true,
          experienceYears: true,
          clusterName: true,
          description: true,
          giTagCertified: true,
          giTagName: true,
        },
      },
    },
  },
} as const;

function imageFor(itemId: string, value: string, query: string): PassportImage {
  if (value.startsWith('data:')) {
    const base = `/api/passport/${encodeURIComponent(itemId)}/image?${query}`;
    return { src: base, unoptimized: true, thumb: `${base}&w=${PASSPORT_THUMB_WIDTH}` };
  }
  return { src: value, unoptimized: value.startsWith('/api/'), thumb: value };
}

function variantsOf(itemId: string, blob: unknown): PassportVariant[] {
  if (!blob || typeof blob !== 'object') return [];
  const variants = (blob as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  return variants
    .filter(
      (v): v is { key: string; label: string; thumb: string } =>
        Boolean(v) &&
        typeof v.key === 'string' &&
        typeof v.label === 'string' &&
        typeof v.thumb === 'string' &&
        v.thumb.startsWith('data:image/')
    )
    .map((v) => ({
      key: v.key,
      labelKey: v.label,
      image: imageFor(itemId, v.thumb, `v=${encodeURIComponent(v.key)}`),
    }));
}

async function loadPassport(where: { id: string } | { patchId: string }, includePatchId: boolean): Promise<Passport | null> {
  // One round of queries, not two. Every read below is keyed on the same
  // item filter, so none has to wait for the item row first — each round
  // trip to the database is ~100 ms from a phone-facing server, and the QR
  // page is the one a judge opens on conference wifi. Results are narrowed back
  // to the exact item afterwards, so two rows that ever shared a patch ID could
  // not mix their records.
  const itemWhere = 'id' in where ? { id: where.id } : { patchId: where.patchId };
  const [item, auditRows, readyRows, moreRows, patchScans] = await Promise.all([
    'id' in where
      ? prisma.craftItem.findUnique({ where: { id: where.id }, select: PASSPORT_SELECT })
      : prisma.craftItem.findFirst({ where: { patchId: where.patchId }, select: PASSPORT_SELECT }),
    prisma.auditLog.findMany({
      where: { craftItem: itemWhere, action: { in: [...PASSPORT_AUDIT_ACTIONS] } },
      select: { craftItemId: true, action: true, actorRole: true, createdAt: true },
    }),
    prisma.artisanOrder.findMany({
      where: { craftItem: itemWhere, readySimilarityScore: { not: null } },
      select: { craftItemId: true, readySimilarityScore: true, readyVerifiedAt: true },
    }),
    prisma.craftItem.findMany({
      where: { ...PURCHASABLE_WHERE, artisan: { craftItems: { some: itemWhere } }, NOT: itemWhere },
      orderBy: { createdAt: 'desc' },
      // One spare, in case the narrowing below drops a row.
      take: MORE_FROM_ARTISAN_LIMIT + 1,
      select: {
        id: true,
        artisanId: true,
        craftType: true,
        images: true,
        salePrice: true,
        askingPrice: true,
        standardMarketPrice: true,
        fairWageFloor: true,
      },
    }),
    'patchId' in where
      ? prisma.demand.findMany({
          where: { deliveryScanPatchId: where.patchId, deliveryScanScore: { not: null } },
          select: { deliveryScanScore: true, deliveryVerifiedAt: true },
        })
      : Promise.resolve(null),
  ]);
  if (!item) return null;

  const auditLogs = auditRows.filter((row) => row.craftItemId === item.id);
  const readyChecks = readyRows.filter((row) => row.craftItemId === item.id);
  const more = moreRows.filter((row) => row.artisanId === item.artisanId && row.id !== item.id).slice(0, MORE_FROM_ARTISAN_LIMIT);
  // By product id the patch is only known now; buyer delivery scans are rare,
  // so this second read happens only for a patched piece on that route.
  const deliveryScans =
    patchScans ??
    (item.patchId
      ? await prisma.demand.findMany({
          where: { deliveryScanPatchId: item.patchId, deliveryScanScore: { not: null } },
          select: { deliveryScanScore: true, deliveryVerifiedAt: true },
        })
      : []);

  const provenance: ProvenanceInput = {
    createdAt: item.createdAt,
    catalogMethod: item.catalogMethod,
    voiceLanguage: item.voiceLanguage,
    hasMaterialBill: Boolean(item.rawMaterialProofUrl),
    photoQualityScore: item.photoQualityScore,
    photoQualitySource: item.photoQualitySource,
    qrVerified: item.qrVerified,
    qrVerifiedAt: item.qrVerifiedAt,
    qrExemptAt: item.qrExemptAt,
    isListedOnMarketplace: item.isListedOnMarketplace,
    syndicatedAt: item.syndicatedAt,
    shopifyPublishedAt: item.shopifyPublishedAt,
    syndicatedChannels: item.syndicatedChannels,
    paidAt: item.paidAt,
    packedAt: item.packedAt,
    dispatchedAt: item.dispatchedAt,
    deliveredAt: item.deliveredAt,
    auditLogs,
  };
  const similarities: SimilarityRecord[] = [
    ...deliveryScans.map((d) => ({ score: Number(d.deliveryScanScore), source: 'DELIVERY_SCAN' as const, at: d.deliveryVerifiedAt })),
    ...readyChecks.map((o) => ({ score: Number(o.readySimilarityScore), source: 'READY_CHECK' as const, at: o.readyVerifiedAt })),
  ];

  const textSources = {
    tags: item.tags,
    catalogTags: catalogTagsOf(item.aiCatalog),
    descriptionEnglish: item.descriptionEnglish,
  };
  const material = materialFrom(textSources);
  const color = colorFrom(textSources);
  const category = categoryFor(item);
  const reason = unpurchasableReason(item);
  const sold = reason === 'sold';
  const profile = item.artisan.artisanProfile;

  return {
    id: item.id,
    patchId: includePatchId ? item.patchId : null,
    craftType: item.craftType,
    descriptionOriginal: item.descriptionOriginal,
    descriptionEnglish: item.descriptionEnglish,
    aiGeneratedListing: item.aiGeneratedListing,
    catalogMethod: item.catalogMethod,
    voiceLanguage: item.voiceLanguage,
    laborDays: item.laborDays && item.laborDays > 0 ? item.laborDays : null,
    material,
    category,
    images: item.images.filter(Boolean).map((value, index) => imageFor(item.id, value, `i=${index}`)),
    variants: variantsOf(item.id, item.imageVariants),
    price: marketPrice(item),
    fairWageFloor: item.fairWageFloor,
    marketPriceMin: item.marketPriceMin,
    marketPriceMax: item.marketPriceMax,
    isListedOnMarketplace: item.isListedOnMarketplace,
    sold,
    buyable: reason === null,
    received: receivedFor({ sold, advancePaid: item.advancePaid, finalPayoutQueued: item.finalPayoutQueued, payoutMode: item.payoutMode }),
    timeline: buildTimeline(provenance),
    trust: buildTrustLayers(provenance, similarities),
    artisan: {
      id: item.artisan.id,
      name: item.artisan.name,
      photoUrl: profile?.photoUrl || null,
      location: profile?.location?.trim() || null,
      craftType: profile?.craftType?.trim() || null,
      experienceYears: profile?.experienceYears && profile.experienceYears > 0 ? profile.experienceYears : null,
      clusterName: profile?.clusterName?.trim() || null,
      bio: profile?.description?.trim() || null,
      gi: giLabelFor(profile),
    },
    moreFromArtisan: more.map((row) => ({
      id: row.id,
      craftType: row.craftType,
      image: row.images[0] ? imageFor(row.id, row.images[0], 'i=0') : null,
      price: marketPrice(row),
    })),
    demandDraft: demandDraftFor({
      craftType: item.craftType,
      category,
      tags: item.tags,
      material: material?.value ?? null,
      color: color?.value ?? null,
    }),
  };
}

/** The QR page. Cached per request so metadata and the page share one load. */
export const loadPassportByPatchId = cache((patchId: string) => loadPassport({ patchId }, true));

/** The marketplace product page. The patch ID stays private here. */
export const loadPassportById = cache((id: string) => loadPassport({ id }, false));
