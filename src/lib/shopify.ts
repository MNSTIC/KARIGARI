import fs from 'fs/promises';
import path from 'path';
import { Prisma, type ShopifyShop } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logCraftItemEvent } from '@/lib/auditLogger';
import { getListingPrice } from '@/lib/pricing';

/**
 * Shopify artisan shops — the whole Admin API surface.
 *
 * SERVER-ONLY. `SHOPIFY_ADMIN_ACCESS_TOKEN` is read here and nowhere else, is
 * never logged, never returned to a caller, and must never get a NEXT_PUBLIC_
 * alias. Plain `fetch` against the Admin GraphQL endpoint; no SDK.
 *
 * THE MODEL. Shopify's Admin API cannot create a store, so there is ONE platform
 * store, provisioned by hand. Each artisan's shop is a custom collection inside
 * it, published to the Online Store so its page resolves, and their name is the
 * `vendor` on every product. See docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md §5.
 *
 * This is the FIRST channel in the app that performs a real outbound write. Every
 * channel in src/lib/syndication.ts only prepares a payload. That difference is
 * why this module has its own routes and its own state columns, and why nothing
 * here may report a publish that Shopify did not confirm.
 *
 * WHY `productSet` AND NOT productCreate + productVariantsBulkUpdate +
 * productUpdate(media) + collectionAddProducts. The plan named that four-step
 * chain. Checking the current Admin reference while building it showed
 * `collectionAddProducts` and `productDeleteMedia` are deprecated, and each extra
 * step is one more place for a publish to half-succeed. `productSet` is a
 * documented synchronous UPSERT keyed on the handle: title, price, stock, the
 * collection and the photo land in one call, and a retry after any failure
 * updates the same product instead of creating a second one. The resume point is
 * the deterministic handle itself, backed by `shopifyProductId` for audit.
 */

const DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || '')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');
const TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '').trim();
const API_VERSION = (process.env.SHOPIFY_API_VERSION || '').trim();
const LOCATION_RAW = (process.env.SHOPIFY_LOCATION_ID || '').trim();

/** Domain, token and version all present. Anything less and every route answers 503. */
export const SHOPIFY_CONFIGURED = Boolean(DOMAIN && TOKEN && API_VERSION);

/** Accepts the gid or the bare number an admin copies out of the Shopify URL bar. */
const LOCATION_ID = LOCATION_RAW
  ? LOCATION_RAW.startsWith('gid://')
    ? LOCATION_RAW
    : `gid://shopify/Location/${LOCATION_RAW.replace(/\D/g, '')}`
  : null;

/** Scopes publishing actually uses. Inventory scopes only matter with a location. */
export const REQUIRED_SCOPES = ['read_products', 'write_products', 'read_publications', 'write_publications'];
export const INVENTORY_SCOPES = ['read_inventory', 'write_inventory'];

// ---------------------------------------------------------------------------
// The one chokepoint
// ---------------------------------------------------------------------------

export type ShopifyFailureKind =
  | 'unconfigured'
  | 'auth'
  | 'scope'
  | 'throttled'
  | 'user'
  | 'graphql'
  | 'http'
  | 'network'
  | 'currency'
  | 'busy';

export interface ShopifyUserError {
  field: string[] | null;
  message: string;
}

export type ShopifyFailure = { ok: false; kind: ShopifyFailureKind; message: string; userErrors?: ShopifyUserError[] };

export type ShopifyResult<T> = { ok: true; data: T } | ShopifyFailure;

/**
 * The sentence the artisan reads beside Retry. Never a stack trace, never the
 * token, never Shopify's raw JSON.
 */
const MESSAGES: Record<Exclude<ShopifyFailureKind, 'user' | 'scope' | 'currency'>, string> = {
  unconfigured: 'Shopify publishing is not set up on this deployment.',
  auth: "The platform's Shopify connection has been disconnected. Ask the administrator to reconnect the store.",
  throttled: 'Shopify is busy right now. Try publishing again in a minute.',
  graphql: 'Shopify could not process this request. Try again, and tell the administrator if it keeps happening.',
  http: 'Shopify is not responding properly right now. Try again in a few minutes.',
  network: 'Could not reach Shopify. Check the connection and retry.',
  busy: 'Your shop is still being set up. Try again in a moment.',
};

function scopeMessage(scope?: string): string {
  return `The platform's Shopify app is missing a permission${scope ? ` (${scope})` : ''}. Ask the administrator to grant it.`;
}

const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 4_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Below this many cost points left in the bucket, pause before the next call. */
const LOW_BUCKET = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with 0–30 % jitter, capped — never an unbounded loop. */
function backoffMs(attempt: number, suggestedMs = 0): number {
  const base = Math.max(suggestedMs, 500 * 2 ** (attempt - 1));
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (1 + Math.random() * 0.3)));
}

interface GraphQLError {
  message?: string;
  extensions?: { code?: string; requiredAccess?: string };
}

interface ThrottleStatus {
  currentlyAvailable?: number;
  restoreRate?: number;
}

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: GraphQLError[] | { message?: string };
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: ThrottleStatus } };
}

/**
 * POST one GraphQL document. Never throws.
 *
 * HTTP failures, top-level GraphQL `errors[]` and a THROTTLED bucket are told
 * apart here. `userErrors` live inside each mutation's payload, so they are
 * checked by `userErrorsOf()` at the call site — a 200 that carries them is a
 * failure, and no caller may read it as success.
 */
export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<ShopifyResult<T>> {
  if (!SHOPIFY_CONFIGURED) return { ok: false, kind: 'unconfigured', message: MESSAGES.unconfigured };

  const endpoint = `https://${DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (error) {
      console.warn(`[shopify] network error (attempt ${attempt}):`, (error as Error)?.name);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, kind: 'network', message: MESSAGES.network };
    }

    if (res.status === 401) return { ok: false, kind: 'auth', message: MESSAGES.auth };
    if (res.status === 403) return { ok: false, kind: 'scope', message: scopeMessage() };
    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        await sleep(backoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
        continue;
      }
      return res.status === 429
        ? { ok: false, kind: 'throttled', message: MESSAGES.throttled }
        : { ok: false, kind: 'http', message: MESSAGES.http };
    }
    if (!res.ok) {
      console.warn(`[shopify] HTTP ${res.status}`);
      return { ok: false, kind: 'http', message: MESSAGES.http };
    }

    const body = (await res.json().catch(() => null)) as GraphQLEnvelope<T> | null;
    if (!body) return { ok: false, kind: 'http', message: MESSAGES.http };

    const errors = Array.isArray(body.errors) ? body.errors : body.errors ? [body.errors as GraphQLError] : [];
    if (errors.length > 0) {
      const throttle = body.extensions?.cost?.throttleStatus;
      if (errors.some((e) => e.extensions?.code === 'THROTTLED')) {
        if (attempt < MAX_ATTEMPTS) {
          // Wait for exactly the points this query needs to drip back in.
          const needed = Math.max(0, (body.extensions?.cost?.requestedQueryCost ?? 10) - (throttle?.currentlyAvailable ?? 0));
          await sleep(backoffMs(attempt, (needed / Math.max(1, throttle?.restoreRate ?? 50)) * 1000));
          continue;
        }
        return { ok: false, kind: 'throttled', message: MESSAGES.throttled };
      }
      const denied = errors.find((e) => e.extensions?.code === 'ACCESS_DENIED');
      if (denied) {
        const scope = denied.extensions?.requiredAccess?.match(/`?(\w+_\w+)`?/)?.[1] ?? denied.message?.match(/(read|write)_\w+/)?.[0];
        return { ok: false, kind: 'scope', message: scopeMessage(scope) };
      }
      console.warn('[shopify] GraphQL errors:', errors.map((e) => e.message).join(' | ').slice(0, 300));
      return { ok: false, kind: 'graphql', message: MESSAGES.graphql };
    }

    // Proactive pacing: a nearly empty bucket throttles the NEXT call, so pause
    // now rather than eat a retry.
    const throttle = body.extensions?.cost?.throttleStatus;
    if (throttle && typeof throttle.currentlyAvailable === 'number' && throttle.currentlyAvailable < LOW_BUCKET) {
      await sleep(Math.min(MAX_BACKOFF_MS, ((LOW_BUCKET - throttle.currentlyAvailable) / Math.max(1, throttle.restoreRate ?? 50)) * 1000));
    }

    if (!body.data) return { ok: false, kind: 'graphql', message: MESSAGES.graphql };
    return { ok: true, data: body.data };
  }

  return { ok: false, kind: 'throttled', message: MESSAGES.throttled };
}

/** A mutation payload's `userErrors`, turned into a failure when non-empty. */
function userErrorsOf(payload: { userErrors?: ShopifyUserError[] | null } | null | undefined): ShopifyFailure | null {
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length === 0) return null;
  return {
    ok: false,
    kind: 'user',
    message: `Shopify refused this listing: ${userErrors[0].message}`,
    userErrors,
  };
}

// ---------------------------------------------------------------------------
// Store facts, cached per server instance
// ---------------------------------------------------------------------------

export interface StoreInfo {
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  /** The storefront origin buyers see, e.g. https://shop.karigari.in */
  primaryUrl: string;
}

const STORE_TTL_MS = 5 * 60_000;
let storeCache: { at: number; info: StoreInfo } | null = null;
let publicationCache: string | null = null;

async function storeInfo(): Promise<ShopifyResult<StoreInfo>> {
  if (storeCache && Date.now() - storeCache.at < STORE_TTL_MS) return { ok: true, data: storeCache.info };
  const result = await shopifyGraphQL<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string; primaryDomain: { url: string } | null };
  }>(`query KarigariShop { shop { name myshopifyDomain currencyCode primaryDomain { url } } }`);
  if (!result.ok) return result;
  const { shop } = result.data;
  const info: StoreInfo = {
    name: shop.name,
    myshopifyDomain: shop.myshopifyDomain,
    currencyCode: shop.currencyCode,
    primaryUrl: (shop.primaryDomain?.url || `https://${shop.myshopifyDomain}`).replace(/\/+$/, ''),
  };
  storeCache = { at: Date.now(), info };
  return { ok: true, data: info };
}

/** The Online Store sales channel. A product or collection not published here 404s. */
async function onlineStorePublicationId(): Promise<ShopifyResult<string>> {
  if (publicationCache) return { ok: true, data: publicationCache };
  const result = await shopifyGraphQL<{
    publications: { nodes: { id: string; catalog: { title: string } | null }[] };
  }>(`query KarigariPublications { publications(first: 25) { nodes { id catalog { title } } } }`);
  if (!result.ok) return result;
  const online = result.data.publications.nodes.find((p) => p.catalog?.title === 'Online Store');
  if (!online) {
    return {
      ok: false,
      kind: 'user',
      message: 'The Shopify store has no Online Store sales channel. Ask the administrator to add it.',
    };
  }
  publicationCache = online.id;
  return { ok: true, data: online.id };
}

/** Whether a currency is one this platform can list in. */
function currencyFailure(info: StoreInfo): ShopifyFailure | null {
  if (info.currencyCode === 'INR') return null;
  return {
    ok: false,
    kind: 'currency',
    message: `The Shopify store's currency is ${info.currencyCode}. Set it to Indian Rupees before publishing.`,
  };
}

async function publishToOnlineStore(id: string): Promise<ShopifyResult<true>> {
  const publicationId = await onlineStorePublicationId();
  if (!publicationId.ok) return publicationId;
  const result = await shopifyGraphQL<{ publishablePublish: { userErrors: ShopifyUserError[] } }>(
    `mutation KarigariPublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
    { id, input: [{ publicationId: publicationId.data }] }
  );
  if (!result.ok) return result;
  // Publishing an already-published resource is a no-op in Shopify, so a
  // retry that reaches this step twice is safe.
  return userErrorsOf(result.data.publishablePublish) ?? { ok: true, data: true };
}

// ---------------------------------------------------------------------------
// testConnection
// ---------------------------------------------------------------------------

export interface ConnectionReport {
  shopName: string;
  myshopifyDomain: string;
  primaryUrl: string;
  currencyCode: string;
  currencyOk: boolean;
  apiVersion: string;
  grantedScopes: string[];
  missingScopes: string[];
  onlineStoreChannel: boolean;
  locationConfigured: boolean;
}

/** A cheap probe an admin can run, so a bad token is diagnosable without server logs. */
export async function testConnection(): Promise<ShopifyResult<ConnectionReport>> {
  storeCache = null;
  publicationCache = null;
  const info = await storeInfo();
  if (!info.ok) return info;

  const scopes = await shopifyGraphQL<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(
    `query KarigariScopes { currentAppInstallation { accessScopes { handle } } }`
  );
  const granted = scopes.ok ? scopes.data.currentAppInstallation.accessScopes.map((s) => s.handle) : [];
  const needed = LOCATION_ID ? [...REQUIRED_SCOPES, ...INVENTORY_SCOPES] : REQUIRED_SCOPES;
  // write_x implies read_x in Shopify, so a store granting only write_products
  // is not reported as missing read_products.
  const has = (scope: string) => granted.includes(scope) || granted.includes(scope.replace(/^read_/, 'write_'));
  const publication = await onlineStorePublicationId();

  return {
    ok: true,
    data: {
      shopName: info.data.name,
      myshopifyDomain: info.data.myshopifyDomain,
      primaryUrl: info.data.primaryUrl,
      currencyCode: info.data.currencyCode,
      currencyOk: info.data.currencyCode === 'INR',
      apiVersion: API_VERSION,
      grantedScopes: granted,
      missingScopes: scopes.ok ? needed.filter((s) => !has(s)) : needed,
      onlineStoreChannel: publication.ok,
      locationConfigured: Boolean(LOCATION_ID),
    },
  };
}

// ---------------------------------------------------------------------------
// ensureArtisanShop
// ---------------------------------------------------------------------------

export function slugify(value: string, max = 40): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'artisan'
  );
}

/** Characters of the row id in a handle: 8 hex = 4.3 billion values, so two artisans never share one. */
const HANDLE_ID_CHARS = 8;

function idSuffix(id: string): string {
  return id.replace(/-/g, '').slice(0, HANDLE_ID_CHARS).toLowerCase();
}

/**
 * Deterministic, so a crash between Shopify's write and ours can be adopted on
 * retry. The name makes it readable; the id suffix makes two artisans with the
 * same name distinct ("…-lakshmi-devi-meher-32756ce6" vs "…-9f10aa21").
 */
export function collectionHandleFor(artisan: { id: string; name: string }): string {
  return `karigari-${slugify(artisan.name)}-${idSuffix(artisan.id)}`;
}

/**
 * The product handle is also productSet's upsert key, so it must be unique per
 * PIECE. `patchId` alone is not: the schema indexes it but does not enforce
 * uniqueness, and two rows sharing one would silently overwrite each other's
 * product. The item id suffix rules that out.
 */
export function productHandleFor(item: { id: string; patchId: string | null; craftType?: string }): string {
  return `karigari-${slugify(item.patchId || item.craftType || 'piece', 50)}-${idSuffix(item.id)}`;
}

export type ShopRow = ShopifyShop;

/** A CREATING claim older than this belongs to a request that died. */
const STALE_SHOP_CLAIM_MS = 90_000;
const SHOP_POLL_ATTEMPTS = 6;

async function waitForActiveShop(artisanId: string): Promise<ShopRow | null> {
  for (let i = 0; i < SHOP_POLL_ATTEMPTS; i += 1) {
    await sleep(1_000);
    const row = await prisma.shopifyShop.findUnique({ where: { artisanId } });
    if (row?.status === 'ACTIVE') return row;
  }
  return null;
}

/**
 * The artisan's collection, created at most once. Idempotent under concurrency.
 *
 *   1. ACTIVE row → return it.
 *   2. CLAIM the row (status CREATING) BEFORE any Shopify write. `artisanId` is
 *      @unique, so of two simultaneous first publishes exactly one insert wins;
 *      the loser inserts nothing and waits for the winner's row to turn ACTIVE.
 *   3. Look the deterministic handle up in Shopify and ADOPT a collection that
 *      already exists — the crash-after-create case.
 *   4. Otherwise create it, then publish it to the Online Store. A collection is
 *      created unpublished, and an unpublished collection's URL is a 404: the
 *      shop link the artisan shares would be dead.
 *   5. Record the handle Shopify actually assigned and mark ACTIVE.
 */
export async function ensureArtisanShop(artisanId: string): Promise<ShopifyResult<ShopRow>> {
  if (!SHOPIFY_CONFIGURED) return { ok: false, kind: 'unconfigured', message: MESSAGES.unconfigured };

  const existing = await prisma.shopifyShop.findUnique({ where: { artisanId } });
  if (existing?.status === 'ACTIVE' && existing.collectionId) return { ok: true, data: existing };

  if (!existing) {
    // ON CONFLICT DO NOTHING on the unique artisanId: the losing request of a
    // race sees count 0 rather than a P2002 exception, which would otherwise
    // be logged as a database error on a perfectly normal path.
    const claimed = await prisma.shopifyShop.createMany({
      data: [{ artisanId, status: 'CREATING', lastSyncedAt: new Date() }],
      skipDuplicates: true,
    });
    if (claimed.count === 0) {
      const row = await waitForActiveShop(artisanId);
      return row ? { ok: true, data: row } : { ok: false, kind: 'busy', message: MESSAGES.busy };
    }
  } else {
    // FAILED, or a CREATING claim whose request died, is taken over atomically.
    const staleBefore = new Date(Date.now() - STALE_SHOP_CLAIM_MS);
    const taken = await prisma.shopifyShop.updateMany({
      where: {
        artisanId,
        OR: [
          { status: 'FAILED' },
          { status: 'CREATING', OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }] },
        ],
      },
      data: { status: 'CREATING', lastSyncedAt: new Date() },
    });
    if (taken.count === 0) {
      const row = await waitForActiveShop(artisanId);
      return row ? { ok: true, data: row } : { ok: false, kind: 'busy', message: MESSAGES.busy };
    }
  }

  const fail = async (result: ShopifyFailure): Promise<ShopifyResult<ShopRow>> => {
    await prisma.shopifyShop.update({ where: { artisanId }, data: { status: 'FAILED' } }).catch(() => undefined);
    return result;
  };

  const artisan = await prisma.user.findUnique({ where: { id: artisanId }, select: { id: true, name: true } });
  if (!artisan) return fail({ ok: false, kind: 'user', message: 'Artisan account not found.' });

  const info = await storeInfo();
  if (!info.ok) return fail(info);
  const wrongCurrency = currencyFailure(info.data);
  if (wrongCurrency) return fail(wrongCurrency);

  const handle = collectionHandleFor(artisan);
  const found = await shopifyGraphQL<{ collections: { nodes: { id: string; handle: string }[] } }>(
    `query KarigariFindCollection($q: String!) { collections(first: 1, query: $q) { nodes { id handle } } }`,
    { q: `handle:${handle}` }
  );
  if (!found.ok) return fail(found);

  let collection = found.data.collections.nodes.find((c) => c.handle === handle) ?? null;
  // Never adopt a collection another artisan's row already owns — the adopt
  // step exists for OUR crash, not to merge two shops.
  if (collection) {
    const owner = await prisma.shopifyShop.findFirst({
      where: { collectionId: collection.id, artisanId: { not: artisanId } },
      select: { id: true },
    });
    if (owner) collection = null;
  }
  if (!collection) {
    const created = await shopifyGraphQL<{
      collectionCreate: { collection: { id: string; handle: string } | null; userErrors: ShopifyUserError[] };
    }>(
      `mutation KarigariCreateCollection($collection: CollectionCreateInput!) {
        collectionCreate(collection: $collection) { collection { id handle } userErrors { field message } }
      }`,
      {
        collection: {
          title: `${artisan.name} · Karigari`,
          handle,
          descriptionHtml: `<p>Handmade by ${escapeHtml(artisan.name)}. Every piece is listed by the artisan who made it, through Karigari.</p>`,
        },
      }
    );
    if (!created.ok) return fail(created);
    const refused = userErrorsOf(created.data.collectionCreate);
    if (refused) return fail(refused);
    collection = created.data.collectionCreate.collection;
    if (!collection) return fail({ ok: false, kind: 'graphql', message: MESSAGES.graphql });
  }

  const published = await publishToOnlineStore(collection.id);
  if (!published.ok) return fail(published);

  const row = await prisma.shopifyShop.update({
    where: { artisanId },
    data: {
      collectionId: collection.id,
      collectionHandle: collection.handle,
      shopUrl: `${info.data.primaryUrl}/collections/${collection.handle}`,
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
    },
  });
  return { ok: true, data: row };
}

// ---------------------------------------------------------------------------
// publishProduct / updateProduct / withdrawProduct
// ---------------------------------------------------------------------------

export interface PublishableItem {
  id: string;
  patchId: string | null;
  craftType: string;
  images: string[];
  selectedImageVariant: string | null;
  descriptionEnglish: string | null;
  aiGeneratedListing: string | null;
  aiCatalog: Prisma.JsonValue | null;
  askingPrice: number | null;
  salePrice: number | null;
  standardMarketPrice: number | null;
  fairWageFloor: number | null;
  tags: string[];
  shopifyProductId: string | null;
  shopifyHandle: string | null;
  shopifySyncedImageKey: string | null;
}

export interface PublishOutcome {
  productId: string;
  variantId: string | null;
  handle: string;
  productUrl: string;
  imageKey: string;
  imageUploaded: boolean;
  price: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function catalogText(item: PublishableItem): { title: string; body: string } {
  const catalog = (item.aiCatalog && typeof item.aiCatalog === 'object' ? item.aiCatalog : {}) as {
    title_en?: unknown;
    desc_en?: unknown;
  };
  const title = typeof catalog.title_en === 'string' && catalog.title_en.trim() ? catalog.title_en.trim() : item.craftType;
  const body =
    (typeof catalog.desc_en === 'string' && catalog.desc_en.trim()) ||
    item.descriptionEnglish?.trim() ||
    item.aiGeneratedListing?.trim() ||
    `${item.craftType}, handmade.`;
  return { title: title.slice(0, 255), body };
}

/** Rupees the buyer pays on Shopify: the REAL listing price. Never a gateway demo amount. */
export function shopifyPriceFor(item: Pick<PublishableItem, 'salePrice' | 'askingPrice' | 'standardMarketPrice' | 'fairWageFloor'>): number | null {
  const price = item.salePrice ?? getListingPrice(item);
  return price && Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}

type ImageSource = { kind: 'bytes'; bytes: Buffer; mimeType: string } | { kind: 'url'; url: string };

/**
 * Where Shopify gets the listing photo from.
 *
 * WHY STAGED UPLOADS rather than pointing Shopify at /api/items/[id]/thumbnail:
 * that route needs the artisan's session cookie, and Shopify's fetcher has
 * none. Photos in this app are data URLs on the row, so the bytes go to
 * Shopify's own storage via `stagedUploadsCreate` and the product references
 * the resulting `resourceUrl`.
 *
 * Seeded demo rows hold `/seed/...` paths. Those are read from `public/` when
 * the file is on disk (local, or traced into the function), and otherwise
 * handed to Shopify as an absolute URL on PUBLIC_BASE_URL, which Shopify can
 * fetch itself — never a localhost URL it cannot reach.
 */
async function resolveImage(src: string): Promise<ImageSource | null> {
  const data = src.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (data) return { kind: 'bytes', bytes: Buffer.from(data[2], 'base64'), mimeType: data[1] };

  if (/^https:\/\//.test(src)) return { kind: 'url', url: src };

  if (src.startsWith('/') && !src.startsWith('//')) {
    const clean = decodeURIComponent(src.split(/[?#]/)[0]);
    const publicDir = path.join(process.cwd(), 'public');
    const file = path.normalize(path.join(publicDir, clean));
    if (file.startsWith(publicDir + path.sep)) {
      try {
        const bytes = await fs.readFile(file);
        const ext = path.extname(file).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return { kind: 'bytes', bytes, mimeType };
      } catch {
        // Not on this instance's disk; fall through to the public URL.
      }
    }
    const base = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    if (/^https:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base)) return { kind: 'url', url: `${base}${clean}` };
  }
  return null;
}

async function stagedUpload(image: { bytes: Buffer; mimeType: string }, filename: string): Promise<ShopifyResult<string>> {
  const staged = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: ShopifyUserError[];
    };
  }>(
    `mutation KarigariStage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    { input: [{ resource: 'IMAGE', filename, mimeType: image.mimeType, httpMethod: 'POST' }] }
  );
  if (!staged.ok) return staged;
  const refused = userErrorsOf(staged.data.stagedUploadsCreate);
  if (refused) return refused;
  const target = staged.data.stagedUploadsCreate.stagedTargets[0];
  if (!target) return { ok: false, kind: 'graphql', message: MESSAGES.graphql };

  // Multipart POST: every returned parameter first, the file LAST — the storage
  // backend's signed policy rejects a form where the file precedes its fields.
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append('file', new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), filename);
  try {
    const res = await fetch(target.url, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.warn(`[shopify] staged upload HTTP ${res.status}`);
      return { ok: false, kind: 'http', message: 'The photo did not upload to Shopify. Retry to finish.' };
    }
  } catch {
    return { ok: false, kind: 'network', message: 'The photo did not upload to Shopify. Retry to finish.' };
  }
  return { ok: true, data: target.resourceUrl };
}

/**
 * Put one piece on the artisan's shop. Resumable, and safe to call again.
 *
 *   1. Store currency must be INR (a rupee number on a dollar store is wrong
 *      by ~80x).
 *   2. The photo is uploaded ONLY when the product is new or the artisan's
 *      chosen look changed since the last sync (`shopifySyncedImageKey`) — a
 *      re-publish of an unchanged listing does not re-upload it.
 *   3. `productSet` upserts by the deterministic handle: title, the AI catalog
 *      copy, vendor, type, tags, ACTIVE status, the collection, the price in
 *      rupees and — when a location is configured — stock of exactly 1 for a
 *      one-of-a-kind piece. `shopifyProductId` and the handle are written the
 *      instant it returns, so a failure in step 4 cannot orphan the product.
 *   4. Publish to the Online Store (a no-op when already published).
 *
 * The image that goes up is `images[0]`, which IS the variant the artisan chose
 * (see `selectedImageVariant`), never the stored original frame.
 */
export async function publishProduct(input: {
  item: PublishableItem;
  artisan: { id: string; name: string; clusterName?: string | null };
  shop: ShopRow;
}): Promise<ShopifyResult<PublishOutcome>> {
  const { item, artisan, shop } = input;
  if (!SHOPIFY_CONFIGURED) return { ok: false, kind: 'unconfigured', message: MESSAGES.unconfigured };
  if (!shop.collectionId) return { ok: false, kind: 'busy', message: MESSAGES.busy };

  const info = await storeInfo();
  if (!info.ok) return info;
  const wrongCurrency = currencyFailure(info.data);
  if (wrongCurrency) return wrongCurrency;

  const price = shopifyPriceFor(item);
  if (!price) return { ok: false, kind: 'user', message: 'This piece has no price yet, so it cannot be listed.' };

  const handle = item.shopifyHandle || productHandleFor(item);
  const imageKey = item.selectedImageVariant ?? 'ORIGINAL';
  const firstPublish = !item.shopifyProductId;
  const needsImage = firstPublish || item.shopifySyncedImageKey !== imageKey;
  const { title, body } = catalogText(item);

  let files: { originalSource: string; contentType: 'IMAGE'; alt: string }[] | undefined;
  if (needsImage) {
    const source = item.images[0] ? await resolveImage(item.images[0]) : null;
    if (!source) {
      return { ok: false, kind: 'user', message: 'This piece has no photo Shopify can use. Add a photo, then publish.' };
    }
    let originalSource: string;
    if (source.kind === 'url') {
      originalSource = source.url;
    } else {
      const ext = source.mimeType === 'image/png' ? 'png' : source.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const uploaded = await stagedUpload(source, `${handle}.${ext}`);
      if (!uploaded.ok) return uploaded;
      originalSource = uploaded.data;
    }
    files = [{ originalSource, contentType: 'IMAGE', alt: `${title} by ${artisan.name}`.slice(0, 500) }];
  }

  const tags = Array.from(
    new Set(
      ['Karigari', 'Handmade', item.craftType, item.patchId, artisan.clusterName, ...item.tags]
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 255))
    )
  ).slice(0, 25);

  const variant: Record<string, unknown> = {
    optionValues: [{ optionName: 'Title', name: 'Default Title' }],
    price: price.toFixed(2),
    // Never oversell a one-of-a-kind piece.
    inventoryPolicy: 'DENY',
  };
  if (LOCATION_ID) {
    variant.inventoryItem = { tracked: true, ...(item.patchId ? { sku: item.patchId } : {}) };
    // Stock is set on FIRST publish only. Re-setting it on a later publish
    // would put a piece that already sold on Shopify back to 1.
    if (firstPublish) variant.inventoryQuantities = [{ locationId: LOCATION_ID, name: 'available', quantity: 1 }];
  }

  const set = await shopifyGraphQL<{
    productSet: {
      product: { id: string; handle: string; variants: { nodes: { id: string }[] } } | null;
      userErrors: ShopifyUserError[];
    };
  }>(
    `mutation KarigariProductSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
      productSet(identifier: $identifier, input: $input, synchronous: true) {
        product { id handle variants(first: 1) { nodes { id } } }
        userErrors { field message }
      }
    }`,
    {
      identifier: { handle },
      input: {
        title,
        handle,
        descriptionHtml: body
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
          .join(''),
        vendor: artisan.name,
        productType: item.craftType.slice(0, 255),
        tags,
        status: 'ACTIVE',
        collections: [shop.collectionId],
        productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
        variants: [variant],
        ...(files ? { files } : {}),
      },
    }
  );
  if (!set.ok) return set;
  const refused = userErrorsOf(set.data.productSet);
  if (refused) return refused;
  const product = set.data.productSet.product;
  if (!product) return { ok: false, kind: 'graphql', message: MESSAGES.graphql };
  const variantId = product.variants.nodes[0]?.id ?? null;

  // The resume point, written before anything else can fail.
  await prisma.craftItem.update({
    where: { id: item.id },
    data: {
      shopifyProductId: product.id,
      shopifyVariantId: variantId,
      shopifyHandle: product.handle,
      ...(files ? { shopifySyncedImageKey: imageKey } : {}),
    },
  });

  const published = await publishToOnlineStore(product.id);
  if (!published.ok) {
    return {
      ...published,
      message: `The product was created but is not on your shop page yet. ${published.message}`,
    };
  }

  return {
    ok: true,
    data: {
      productId: product.id,
      variantId,
      handle: product.handle,
      productUrl: `${info.data.primaryUrl}/products/${product.handle}`,
      imageKey,
      imageUploaded: Boolean(files),
      price,
    },
  };
}

/**
 * A re-publish after the artisan edits a listing or changes its look. Same
 * upsert — `productSet` updates by handle — so there is exactly one code path
 * that writes a product and it cannot drift from the first publish.
 */
export const updateProduct = publishProduct;

/**
 * Take a piece off the storefront once it sells on Karigari.
 *
 * DRAFT rather than delete: the Shopify product keeps its history, and an
 * administrator can still see it. Best effort — the Karigari sale is already
 * committed, and this must never turn a real payment into an error.
 */
export async function withdrawProduct(productId: string): Promise<ShopifyResult<true>> {
  const result = await shopifyGraphQL<{ productUpdate: { userErrors: ShopifyUserError[] } }>(
    `mutation KarigariWithdraw($product: ProductUpdateInput!) {
      productUpdate(product: $product) { userErrors { field message } }
    }`,
    { product: { id: productId, status: 'DRAFT' } }
  );
  if (!result.ok) return result;
  return userErrorsOf(result.data.productUpdate) ?? { ok: true, data: true };
}

/**
 * After a Karigari sale: if this piece is live on Shopify, take it off.
 *
 * Every piece is one of a kind. Without this, a saree a buyer just paid for on
 * Karigari would stay purchasable on the artisan's Shopify shop. Called from
 * `after()` in the payment route, so the buyer's confirmation never waits on
 * Shopify. Never throws.
 *
 * A withdrawn piece is recorded as WITHDRAWN. If Shopify refuses, the row stays
 * LIVE and says so in `shopifySyncError`, so the artisan's card shows the
 * problem instead of silently claiming the piece came down.
 *
 * `soldVia` only changes the wording recorded: an artisan who logged a haat
 * sale (POST /api/artisan/offline-sales) must not be told the piece "sold on
 * Karigari", because it did not.
 */
export async function withdrawSoldPiece(
  craftItemId: string,
  soldVia: 'KARIGARI' | 'OFFLINE' = 'KARIGARI'
): Promise<void> {
  const soldWhere = soldVia === 'OFFLINE' ? 'Sold offline' : 'Sold on Karigari';
  if (!SHOPIFY_CONFIGURED) return;
  try {
    const item = await prisma.craftItem.findUnique({
      where: { id: craftItemId },
      select: { id: true, artisanId: true, shopifyProductId: true, shopifyStatus: true },
    });
    if (!item?.shopifyProductId || item.shopifyStatus === 'WITHDRAWN' || item.shopifyStatus === null) return;

    const result = await withdrawProduct(item.shopifyProductId);
    await prisma.craftItem.update({
      where: { id: item.id },
      data: result.ok
        ? { shopifyStatus: 'WITHDRAWN', shopifyStatusAt: new Date(), shopifySyncError: null }
        : {
            shopifySyncError:
              soldVia === 'OFFLINE'
                ? 'You logged this piece as sold offline, but it is still on your Shopify shop. Ask the administrator to set it to draft.'
                : 'This piece sold on Karigari but is still on your Shopify shop. Ask the administrator to set it to draft.',
          },
    });
    await logCraftItemEvent({
      prisma,
      craftItemId: item.id,
      actorId: 'SHOPIFY_SYNC',
      actorRole: 'SYSTEM',
      action: result.ok ? 'SHOPIFY_WITHDRAWN_AFTER_SALE' : 'SHOPIFY_WITHDRAW_FAILED',
      newState: { shopifyProductId: item.shopifyProductId, ...(result.ok ? {} : { kind: result.kind }) },
      comments: result.ok
        ? `${soldWhere}, so the Shopify product was set to draft and can no longer be bought there.`
        : `${soldWhere}, but Shopify refused to take the product down: ${result.message}`,
    });
    if (result.ok) {
      await prisma.shopifyShop.updateMany({
        where: { artisanId: item.artisanId },
        data: {
          productCount: await prisma.craftItem.count({ where: { artisanId: item.artisanId, shopifyStatus: 'LIVE' } }),
          lastSyncedAt: new Date(),
        },
      });
    }
  } catch (error) {
    console.error('[shopify] withdraw after sale failed:', (error as Error)?.message);
  }
}

/** For the product link in the UI, from a stored shop URL and product handle. */
export function productUrlFrom(shopUrl: string | null, handle: string | null): string | null {
  if (!shopUrl || !handle) return null;
  try {
    return `${new URL(shopUrl).origin}/products/${handle}`;
  } catch {
    return null;
  }
}
