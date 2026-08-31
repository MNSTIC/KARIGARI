# MASTER PROMPT — Zero-ID Multi-Platform Syndication + Direct-to-Artisan Non-Custodial Escrow

> Paste this whole file into **Claude Code**. It has access to the repo. Work **only** inside the app root below. Ship neat, strictly-typed, build-green code.

---

## 0. ORIENTATION — READ BEFORE TOUCHING ANYTHING

**App root (IMPORTANT — the project is nested one level down):**
```
KARIGARI-main/KARIGARI/
```
`cd` into `KARIGARI-main/KARIGARI/` first. `package.json` (name `karigari-app`), `prisma/`, `src/` all live there. Do **not** create files in the outer `KARIGARI-main/`.

**Stack (verified from package.json):** Next.js **16.3.1** (App Router), React **19.2**, TypeScript 5, Prisma **7.9** with the **`@prisma/adapter-pg`** driver-adapter (PostgreSQL), Tailwind CSS **v4**, `lucide-react` icons, `jsonwebtoken` auth, `recharts`.

**⚠️ Next.js 16 is NOT the Next.js in your training data.** `AGENTS.md` / `CLAUDE.md` in the root say so explicitly. Before writing route handlers or dynamic pages, read the relevant guide under `node_modules/next/dist/docs/` (resolved from the repo). In particular:
- Route handlers are `src/app/**/route.ts` exporting `GET`/`POST`.
- **Dynamic route params are async** — a `[id]` page/route receives `params` as a `Promise`; `await` it (e.g. `const { id } = await params;`). Do not destructure synchronously.
- `cookies()` from `next/headers` is **async** — `await cookies()` (every existing route already does this).

**Build must stay green.** When done, `npm run build` must compile all routes with zero TypeScript errors. Run it as the final step and fix anything red.

---

## 1. HOUSE CONVENTIONS — MATCH THESE EXACTLY (do not reinvent)

**Prisma client:** always `import { prisma } from '@/lib/prisma';` (singleton with the pg adapter). Never `new PrismaClient()`.

**Auth in API routes:** copy the `requireArtisan()` helper verbatim from `src/app/api/artisan/listings/route.ts` (also in `src/app/api/artisan/gem-export/route.ts`). It reads the JWT cookie and 401/403s. Key facts:
- The auth cookie is named **`auth-token`** (hyphen). `src/app/api/items/market/route.ts` reads `auth_token` (underscore) — that is a pre-existing bug; **use `auth-token`** in all new code and do not copy the buggy spelling.
- JWT is verified with `jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret')` → `{ userId, role }`.
- Roles are the `Role` enum: `ADMIN | ARTISAN`.

**Audit logging:** use `logCraftItemEvent` from `@/lib/auditLogger`. Signature:
```ts
logCraftItemEvent({ prisma, craftItemId, actorId?, actorRole?, action, previousState?, newState?, comments? })
```
`AuditLog.craftItemId` is **required** and FK-bound to a real `CraftItem`, so only log against an existing item id. There is no free-text `actor` column — map the spec's `actor:` to **`actorId`** (and set `actorRole: "SYSTEM"`).

**Pricing (single source of truth):** reuse `@/lib/pricing`:
- `getListingPrice(item)` → the artisan's effective list price (use `salePrice ?? getListingPrice(item)`).
- `formatRupees(value)` → `₹1,23,456` formatting. Use it everywhere money is shown.
Do **not** hand-roll price math or currency formatting.

**Catalog serializers (reuse for the export button):** `@/lib/ondcCatalog` (`buildOndcCatalog`, `ONDC_ITEM_SELECT`, `CatalogItem`, `absoluteImages`, `slugify`, `splitLocation`) and `@/lib/gemCatalog` (`toGemRows`, `toGemCsv`, `toGemJson`). The existing endpoints `GET /api/ondc/catalog?artisanId=...` and `GET /api/artisan/gem-export?format=csv|json` already produce downloadable feeds — **the Syndication Hub export button must call these, not duplicate their logic.**

**Theme (green heritage) — use Tailwind tokens, never raw hex.** Defined in `src/app/globals.css` under `@theme`:
- `primary #24332C`, `primary-dark #1A2721`, `primary-light #3D5145`
- `background #FCF8F7`, `card #FFFFFF`, mint `#DCEBE0` (`var(--color-mint)`), sage `#A9BFB0` (`var(--color-sage)`)
Use classes like `bg-primary`, `text-primary`, `bg-primary-dark`, `bg-card`, `bg-[var(--color-mint)]`, `border-[var(--color-sage)]`, `rounded-2xl`, `shadow-card`, `font-serif`. Match the card/tab styling already in `src/app/artisan/market/page.tsx`. Every screen must be responsive (mobile-first, the pages already are).

**i18n:** artisan pages use `const { t } = useLanguage()` from `@/lib/translations`. `translations.ts` is huge (~170 KB); **do not risk corrupting it.** For new labels, plain English string literals are acceptable — keep them short and in the heritage tone. Do not remove or break existing `t()` calls.

**Client vs server:** pages that use hooks/state start with `"use client";` (see market/dashboard/buyer pages). API routes that touch the DB per-request must export `export const dynamic = 'force-dynamic';` (every existing artisan route does).

---

## 2. GOLDEN FINANCIAL-GOVERNANCE RULE (non-negotiable)

> **Admins, facilitators, and middlemen have ZERO financial authority.** They never hold, touch, or manually approve any payout. The entire money pipeline is triggered **programmatically** by dispatch/delivery events and flows **directly to the artisan's registered UPI/bank destination.**

Bake this into the code shape: the settlement route is fired by an `ACTION` trigger (dispatch / delivered), **not** gated behind an admin approval step, and it writes the artisan's own `upiId` as the payout destination.

### HONESTY (bake into UI copy — do not fake real money movement or real government transmission)
This is a hackathon prototype. Be truthful, exactly like the existing ONDC/GeM features already are:
- **Stripe runs in TEST mode** (`process.env.STRIPE_SECRET_KEY`, fallback `sk_test_...`). No live charges.
- Real UPI/bank **payout rails are not wired** (Stripe cannot settle to Indian VPAs in test). So the "direct-to-artisan" transfers are executed as **programmatic non-custodial settlement records** — the escrow state machine, ledger fields, and immutable audit trail are 100% real; the actual bank credit is simulated. Label payout UI as *"Programmatic settlement (test) — direct to artisan VPA, zero middleman"*, never as a confirmed bank credit.
- ONDC/GeM syndication is **broadcast/export-ready**, not a live transmission to those portals (same honest framing as `/api/ondc/catalog` and `gem-export`).

---

## 3. FEATURE 1 — Zero-ID Multi-Platform Syndication & Price-Comparison Engine

### 3.1 Schema (`prisma/schema.prisma`)
On `model CraftItem`, add next to the existing `isListedOnMarketplace Boolean @default(false)`:
```prisma
isOndcLive        Boolean  @default(false)
syndicatedChannels String[]            // e.g. ["ONDC_PAYTM","ONDC_MAGICPIN","GEM","AMAZON_KARIGAR"]
syndicatedAt      DateTime?
```
(These are additive and nullable/defaulted, so no data migration risk.)

### 3.2 New API — `src/app/api/artisan/syndicate/route.ts`
Use `requireArtisan()`, `export const dynamic = 'force-dynamic'`.

**`POST`** — body `{ craftItemId: string, targetPlatforms: string[] }`:
1. Verify the item exists **and belongs to the caller** (`artisanId === userId`) — else 403/404. This enforces Zero-ID: the artisan is the only owner; no external seller account.
2. Update the item: `isListedOnMarketplace = true`, `isOndcLive = true`, `syndicatedChannels` = the requested platforms, `syndicatedAt = new Date()`.
3. Write one immutable audit entry via `logCraftItemEvent`: `action: "MULTI_CHANNEL_SYNDICATE"`, `actorId: userId`, `actorRole: "ARTISAN"`, `newState: { targetPlatforms }`.
4. Return `{ success: true, item }`.

**`GET`** — `/api/artisan/syndicate?id=<craftItemId>` returns a **live price-comparison matrix** for that item, computed from its real listing price (no mock rows). Let `base = salePrice ?? getListingPrice(item)`:
| channel key | label | buyerPays | artisanReceivesNote | commissionPct |
|---|---|---|---|---|
| `KARIGARI_ONDC` | Karigari Direct (ONDC) | `base` | full fair price, 0% middleman | 0 |
| `ONDC_PAYTM_MAGICPIN` | Paytm / Magicpin (ONDC) | `round(base * 1.035)` | buyer app finder fee only; artisan still gets `base` | 3.5 |
| `GEM_B2G` | GeM (Govt B2G) | `base` (bulk quote) | 0% commission | 0 |
| `AMAZON_FLIPKART` | Amazon Karigar / Flipkart Samarth | `round(base * 1.15)` | platform takes 15% | 15 |
Return `{ success: true, base, comparisons: [...] }`. Also compute and return the artisan's headline **"0% middleman advantage"** — the rupee gap between Amazon/Flipkart buyer price and Karigari Direct. Handle a null/absent `base` gracefully (return an empty/`base: null` matrix, no NaN).

### 3.3 Frontend — new tab in `src/app/artisan/market/page.tsx`
The page already has a `tab` state (`"listings" | "buyers"`) and a tab-button row. **Add a third tab** `"syndication"` labeled **"Zero-ID Multi-Channel Syndication Hub"** (icon: `Zap` from lucide-react), styled identically to the existing tabs. In its panel:
- **Master switch** button **"⚡ Publish to All Connected Channels"** that, for the selected/live listing(s), `POST`s to `/api/artisan/syndicate` with all four platform keys, then shows a success state (`syndicatedChannels` reflected as green channel chips). Disable while in-flight; show per-item state.
- A per-listing **Live Price Comparison Matrix** (fetched from `GET /api/artisan/syndicate?id=`) rendered as a clean responsive table/cards: each channel row shows label, buyer price (`formatRupees`), commission %, and Karigari Direct highlighted with a **"0% middleman"** badge in mint/sage. Surface the headline advantage line (e.g. *"You keep ₹X more than Amazon by selling direct on ONDC"*).
- **Export button** **"Download GeM & ONDC Compliant JSON / CSV"** offering: GeM CSV → `/api/artisan/gem-export?format=csv`; GeM JSON → `/api/artisan/gem-export?format=json`; ONDC Beckn JSON → `/api/ondc/catalog?artisanId=<currentArtisanId>`. Reuse those existing endpoints; render as download links/buttons. Keep honest copy ("upload-ready for gem.gov.in / broadcast-ready ONDC payload").

Reuse the page's existing `listings` data + loading/error patterns; do not add a second data-fetch framework.

### 3.4 Public "Marketplace" entry on the landing page (`src/app/page.tsx`)
- Add a **"Marketplace"** item to the top nav (desktop links row) linking to `/marketplace`, and a prominent **"Explore Marketplace"** button in the hero CTA group — styled with the existing `bg-primary`/rounded-full button classes. Keep the existing layout, theme, and stat banner intact.
- Build a **public consumer storefront** `src/app/marketplace/page.tsx` (`"use client"`): a responsive grid of published craft items. Fetch from `GET /api/items/market` and **display only items where `isListedOnMarketplace === true`** (filter client-side, or add a `?listed=1` filter to that route — if you edit that route, also fix its cookie name to `auth-token`). Each card shows image, craftType, artisan cluster, `formatRupees(getListingPrice(item))`, a "Verified" badge when `patchId` is set, and links to `/marketplace/product/[id]`. Match the card styling from the market/buyer pages.

---

## 4. FEATURE 2 — Direct-to-Artisan Stripe Checkout + Automated Non-Custodial Escrow

### 4.1 Dependency + env
- Install Stripe: `npm install stripe`. Import server-side only: `import Stripe from 'stripe';` and instantiate with `new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_...')` inside the route (not at module top-level in a way that breaks the build when the key is absent).
- Add to **`.env`** and **`.env.example`** (names only in example): `STRIPE_SECRET_KEY=sk_test_...` and `NEXT_PUBLIC_BASE_URL` (a `PUBLIC_BASE_URL` already exists — reuse it for absolute success/cancel URLs; fall back to the request origin).

### 4.2 Schema (`prisma/schema.prisma`)
- On `ArtisanProfile`: `upiId String?` already exists — keep it. **Add** `bankAccountNumber String?`.
- On `CraftItem` add:
```prisma
stripeSessionId        String?
escrowStatus           String?   // "ESCROW_HELD" | "STAGE1_ADVANCE_PAID_40" | "STAGE2_SETTLED_89"
advanceAmount          Float?    // 40% of gross
finalSettlementAmount  Float?    // final direct-to-artisan amount (~49.36%)
artisanUpiDestination  String?   // the artisan's direct VPA snapshot at checkout
```
Keep the **existing** `advancePaid`, `finalPayoutQueued`, `salePrice`, `status` fields working — the dashboard earnings API reads them (see §4.6), so the escrow route must update them too.

After editing the schema, run `npx prisma generate` (and `npx prisma db push` if a live DB is configured) so the client types are regenerated before you build.

### 4.3 Stripe Checkout — `src/app/api/payments/create-checkout/route.ts`
`POST` (public; a consumer is buying). Body `{ craftItemId: string }`.
1. Load the item + its artisan's `artisanProfile.upiId`. Compute price = `salePrice ?? getListingPrice(item)`; guard against null.
2. Create a Stripe Checkout Session, mode `payment`, currency **`inr`**, one `line_item` (product name = craftType, unit_amount = `Math.round(price * 100)`, quantity 1).
3. `metadata: { craftItemId, artisanId, artisanUpi: profile?.upiId ?? '', askingPrice: String(price) }`.
4. `success_url: \`${base}/marketplace?payment=success&session_id={CHECKOUT_SESSION_ID}\``, `cancel_url: \`${base}/marketplace/product/${craftItemId}?payment=cancelled\``.
5. Persist onto the item: `stripeSessionId = session.id`, `escrowStatus = "ESCROW_HELD"`, `artisanUpiDestination = profile?.upiId ?? null`, `advanceAmount = round(price * 0.40)`, `finalSettlementAmount = round(price * 0.4936)`. Log `logCraftItemEvent({ action: "ESCROW_HELD", actorId: "STRIPE_CHECKOUT", actorRole: "SYSTEM", newState: { sessionId: session.id, price } })`.
6. Return `{ success: true, url: session.url }`. (Frontend redirects to `session.url`.)

### 4.4 Automated non-custodial settlement — `src/app/api/payments/settle-escrow/route.ts`
`POST` — programmatic trigger (dispatch/delivery webhook or the demo button). Body `{ craftItemId: string, action: "DISPATCH" | "DELIVERED" }`. **No admin auth gate that could hold funds** — this is machine-triggered per the golden rule.

- **`action === "DISPATCH"`** (Stage 1 — 40% Fair Wage Advance):
  - Require current `escrowStatus === "ESCROW_HELD"` (idempotent: if already `STAGE1_...` or beyond, return success without double-paying).
  - Compute advance = `advanceAmount ?? round(price * 0.40)`. "Transfer" it **directly to `artisanUpiDestination`** (programmatic settlement record — see honesty note).
  - Update: `escrowStatus = "STAGE1_ADVANCE_PAID_40"`, `advancePaid = advance`, `status = "ADVANCE_PAID"`.
  - Log `logCraftItemEvent({ action: "DIRECT_ARTISAN_ADVANCE_PAID", actorId: "SMART_ESCROW_ENGINE", actorRole: "SYSTEM", newState: { advance, destination: artisanUpiDestination } })`.

- **`action === "DELIVERED"`** (Stage 2 — final settlement, ~49.36%):
  - Require `escrowStatus === "STAGE1_ADVANCE_PAID_40"` (idempotent otherwise).
  - Compute final so that total to artisan ≈ **89.36%** of gross: `final = finalSettlementAmount ?? round(price * 0.4936)`. Platform retains the nominal **3.5%** maintenance fee; the remainder covers logistics/gateway (mirror the whitepaper unit economics — document the split in a comment).
  - "Transfer" final **directly to `artisanUpiDestination`**.
  - Update: `escrowStatus = "STAGE2_SETTLED_89"`, `finalPayoutQueued = final`, `salePrice = salePrice ?? price`, `status = "SOLD_FINAL"`.
  - Log `logCraftItemEvent({ action: "DIRECT_ARTISAN_FINAL_SETTLEMENT", actorId: "SMART_ESCROW_ENGINE", actorRole: "SYSTEM", newState: { final, platformFee: round(price*0.035), destination: artisanUpiDestination } })`.

Return `{ success: true, escrowStatus, paid, destination }`. Wrap DB writes so a single item update + audit log are consistent (use `prisma.$transaction` if doing multiple writes).

### 4.5 Product page + Buy Now — `src/app/marketplace/product/[id]/page.tsx`
- Create the dynamic page (`"use client"` for the buy interaction; remember **`params` is a Promise** in Next 16 — `await` it in a server wrapper or read the id via `useParams()` in the client component).
- Fetch the single item. If no single-item endpoint exists, add `GET /api/items/market?id=<id>` support (return one item) or a new `src/app/api/items/[id]/route.ts` — keep it public and dynamic.
- Render image gallery, craftType, artisan/cluster, description (`descriptionEnglish || aiGeneratedListing`), verified/patch badge, and `formatRupees` price. Show a small trust line: *"Escrow-protected · 40% fair-wage advance to the artisan on dispatch · direct to VPA, zero middleman."*
- Wire **"Buy Now via Stripe"**: `POST /api/payments/create-checkout` with `{ craftItemId: id }`, then `window.location.href = data.url`. Handle loading/error states.
- On `/marketplace?payment=success`, show a success toast/banner (read `payment` from the URL like other pages read query params without `useSearchParams`, to avoid needing a Suspense boundary — see the pattern in `dashboard/page.tsx`).

### 4.6 Artisan earnings tracker — `src/app/artisan/dashboard/page.tsx` (+ its API)
- Extend `GET /api/artisan/dashboard` (`src/app/api/artisan/dashboard/route.ts`) to also aggregate escrow data for the caller: `totalGrossSales` (sum of `salePrice` where sold), `advancesReceived` (sum `advancePaid` where `escrowStatus` in the STAGE1+ set), `finalSettlementsCleared` (sum `finalPayoutQueued` where `escrowStatus === "STAGE2_SETTLED_89"`), and the artisan's `upiId`. Add these to the returned `data` object without breaking existing fields/trends.
- In the dashboard page, add a **"Live Earnings & Direct UPI Settlement Tracker"** card block showing: Total Gross Sales, 40% Instant Advances Received, Final Settlements Cleared, each with `formatRupees`, and a destination badge:
  `🟢 Direct to VPA: {upiId} — Zero Middleman Intervention` (render in mint/sage with `text-primary`; if no `upiId`, prompt them to add one via the existing profile editor). Reuse `StatCard` from `@/components/ui/StatCard` for the numbers if it fits.

---

## 5. VERIFICATION & QUALITY GATE (do all of these)

1. **Types:** zero TypeScript errors; no `any` leaks in new code beyond what the codebase already uses; all new Prisma fields referenced with the regenerated client.
2. **Prisma:** `npx prisma generate` succeeds; schema additions are additive (no destructive migration).
3. **Build:** `npm run build` compiles **all** routes cleanly (the app has 45+ routes — none should break). Fix every error/warning you introduced.
4. **Golden rule audit:** grep to confirm no admin/facilitator route can trigger or approve a payout; the only payout writers are `create-checkout` (escrow hold) and `settle-escrow` (`actorId: "SMART_ESCROW_ENGINE"`). Payout destination is always the artisan's own `upiId`.
5. **Idempotency:** re-POSTing the same `settle-escrow` action does not double-pay (state-guarded).
6. **Honesty copy present:** Stripe test-mode, programmatic-settlement, and export-only (ONDC/GeM) labels are visible in the UI, not hidden.
7. **Theme + responsive:** new tab, storefront, product page, and tracker use the heritage tokens (`primary #24332C`, mint `#DCEBE0`) and are mobile-friendly; existing `t()` i18n untouched.
8. Summarize the diff at the end: files created, files edited, schema fields added, new env vars, and the exact `npm`/`prisma` commands you ran.

---

### FILE MAP (quick reference)
**Create:** `src/app/api/artisan/syndicate/route.ts`, `src/app/marketplace/page.tsx`, `src/app/marketplace/product/[id]/page.tsx`, `src/app/api/payments/create-checkout/route.ts`, `src/app/api/payments/settle-escrow/route.ts`, (optional) `src/app/api/items/[id]/route.ts`.
**Edit:** `prisma/schema.prisma`, `src/app/page.tsx`, `src/app/artisan/market/page.tsx`, `src/app/artisan/dashboard/page.tsx`, `src/app/api/artisan/dashboard/route.ts`, `.env`, `.env.example`, (if you add the listed filter/cookie fix) `src/app/api/items/market/route.ts`.
**Reuse (do not fork):** `@/lib/prisma`, `@/lib/auditLogger`, `@/lib/pricing` (`getListingPrice`, `formatRupees`), `@/lib/ondcCatalog`, `@/lib/gemCatalog`, `requireArtisan()` pattern, `@/components/ui/StatCard`, `@/lib/translations` (`useLanguage`).
