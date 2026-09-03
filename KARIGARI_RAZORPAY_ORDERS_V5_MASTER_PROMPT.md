# MASTER PROMPT — KARIGARI Razorpay Payments + Buyer "My Orders" V5

> Paste into **Claude Code** (it already has this repo). Replace Stripe with Razorpay Standard Checkout, wire the real payment flow, force the actual charge to ₹1 while keeping displayed prices unchanged, and add a buyer **My Orders** tab with Flipkart/Amazon-style order tracking. **After implementing, run the verification pass in §V and fix every error before reporting done.** Work only inside the app root. Keep the green-heritage theme, i18n, and responsiveness.

---

## 0. ORIENTATION (read first — do not skip)

**App root (nested one level down):** `KARIGARI-main/KARIGARI/` — `cd` there. `package.json` = `karigari-app`.

**Stack:** Next.js **16.3.1** App Router (Turbopack), React **19.2**, TS 5, Prisma **7.9** + `@prisma/adapter-pg` (Postgres), Tailwind **v4**, `lucide-react`.

**⚠️ Next 16 ≠ training-data Next.** Route handlers live in `src/app/api/**/route.ts` and export `async function POST(req: Request)`. Use `export const dynamic = 'force-dynamic'` on payment routes (existing routes already do). Dynamic `params` is a Promise; `cookies()` is async. Client pages read the query string via `window.location.search` in a deferred `useEffect`, never `useSearchParams`.

**Conventions to match:**
- Prisma singleton: `import { prisma } from '@/lib/prisma'`. Run `npx prisma generate` + a migration (`npx prisma migrate dev --name razorpay_orders`) after schema edits.
- Money helpers: `getListingPrice`, `formatRupees` from `@/lib/pricing`. Escrow split constants in `@/lib/escrow` (`advanceFor`, `finalSettlementFor`, `creatorCommissionFor`, `ESCROW_HELD`, `STAGE1_ADVANCE_PAID_40`, `STAGE2_SETTLED_89`).
- Audit: `logCraftItemEvent({ prisma, craftItemId, actorId?, actorRole?, action, newState?, comments? })` from `@/lib/auditLogger`.
- Theme tokens in `globals.css` (`primary #24332C`, mint `var(--color-mint)`, sage, pill). Use `bg-primary`, `rounded-2xl`, `shadow-card`, `font-serif`, `kg-press`. i18n via `useLanguage()`; **every new string → all four locale files** `src/lib/i18n/{en,hi,or,te}.ts`.

**Current payment surface (what you are replacing):**
- `src/app/api/payments/create-checkout/route.ts` — **Stripe** hosted checkout: `new Stripe(secretKey)`, `stripe.checkout.sessions.create(...)`, returns `{ url }`, writes `stripeSessionId`, `escrowStatus=ESCROW_HELD`, `advanceAmount`, `finalSettlementAmount`, affiliate fields.
- `src/app/api/payments/settle-escrow/route.ts` — programmatic two-tranche settlement (`DISPATCH` → 40% advance, `DELIVERED` → final + creator commission). **Keep this** — it is the settlement state machine and is not Stripe-specific except in comments.
- `src/app/marketplace/product/[id]/ProductClient.tsx` — the **Buy** button: `buyNow()` POSTs to `create-checkout` then `window.location.href = data.url` (redirect). i18n key `buy_now_stripe`. Reads `?payment=success|cancelled`.
- `src/app/marketplace/page.tsx` — handles `?payment=success` after the Stripe redirect.
- Schema (`prisma/schema.prisma`, `model CraftItem`): `stripeSessionId`, `escrowStatus`, `advanceAmount`, `finalSettlementAmount`, `artisanUpiDestination`, `productionStage`, affiliate fields. `model Demand`: `buyerName`, `referenceImageUrl`, `material`, `color`, `status (OPEN|MATCHED|FULFILLED)`.
- Env: `.env` and `.env.example` have `STRIPE_SECRET_KEY=` and `NEXT_PUBLIC_BASE_URL=`. `.gitignore` already ignores `.env*` and keeps `!.env.example`.
- Package: `"stripe": "^22.6.0"` is a dependency. Razorpay is **not** installed.

**Buyer context:** `/buyer` (`src/app/buyer/page.tsx`) is an **unauthenticated** storefront. The buyer identity is a free-text name in `localStorage` under `BUYER_NAME_KEY = "karigari_buyer_name"`. It already renders the demand board and per-demand tracking via `OrderTimeline` (`src/components/ui/OrderTimeline.tsx`) fed by `GET /api/demand/track?demandId=` — reuse these, do not rebuild them.

---

## PART 1 — Razorpay Standard Checkout (replace Stripe)

### 1.1 Install + env (never hardcode credentials)
1. `npm install razorpay` (Node SDK). Then **remove Stripe**: `npm uninstall stripe` and delete the `"stripe"` dependency from `package.json`.
2. Add to **`.env`** and **`.env.example`** (KEY_SECRET is server-only; KEY_ID is public via the `NEXT_PUBLIC_` prefix):
   ```
   RAZORPAY_KEY_ID=rzp_test_TXRPhh1tAEPKvD
   RAZORPAY_KEY_SECRET=nPiFSaUdqtM94IUyqtp2KGHG
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_TXRPhh1tAEPKvD
   ```
   In `.env.example`, put placeholder values (`rzp_test_...`, `your_secret_here`), not the real secret. Remove the `STRIPE_SECRET_KEY=` line from both. `.gitignore` already excludes `.env*` — verify. **The secret must never appear in any client component or in `NEXT_PUBLIC_` anything.**
3. Add a small server helper `src/lib/razorpay.ts`: export `RAZORPAY_KEY_ID`, a lazily-constructed `razorpay` client (`new Razorpay({ key_id, key_secret })`), a `RAZORPAY_CONFIGURED` boolean (both env vars present), and `verifyRazorpaySignature(orderId, paymentId, signature)` using `crypto.createHmac('sha256', KEY_SECRET).update(orderId + '|' + paymentId).digest('hex')` compared with `crypto.timingSafeEqual`. No React/Prisma imports here.

### 1.2 The ₹1 demo-charge rule (displayed price stays unchanged)
- **Actual amount charged via Razorpay = 100 paise (₹1) for every item**, because all users are dummy and this is a demo.
- **Everything the buyer SEES stays the real listing price** — the product page, marketplace cards, order summary, escrow tranche figures, artisan earnings — all keep computing from `getListingPrice(item)` exactly as now. Only the Razorpay `order.amount` is hardcoded to `100` paise.
- Add a single constant `export const DEMO_CHARGE_PAISE = 100;` in `src/lib/razorpay.ts` and use it as the order amount, with a comment explaining the demo rule so it is obvious and easy to revert.

### 1.3 Backend — create order
Replace the body of `src/app/api/payments/create-checkout/route.ts` (rename to `create-order` if you prefer the Razorpay naming — if you rename the route folder, update the caller in `ProductClient.tsx`; otherwise keep the path and just swap the implementation):
- Validate `craftItemId` (400 if missing). Load the item as today (id, artisanId, craftType, images, prices, artisan name + `artisanProfile.upiId`). 404 if not found; 409 if it has no displayed price (`getListingPrice`).
- If `!RAZORPAY_CONFIGURED`, return 503 with a plain message (mirror the current Stripe-not-configured behaviour) so the storefront still works.
- Create a Razorpay order: `razorpay.orders.create({ amount: DEMO_CHARGE_PAISE, currency: 'INR', receipt: item.id, notes: { craftItemId, artisanId, displayPrice: String(price), ref } })`. Amount is ₹1; `amount >= 100` is satisfied.
- Resolve the affiliate `ref` exactly as today (active creator handle → `affiliateCommission = creatorCommissionFor(price)` from the **display** price).
- Persist onto the item: `razorpayOrderId = order.id`, `escrowStatus = ESCROW_HELD`, `artisanUpiDestination`, `advanceAmount = advanceFor(price)`, `finalSettlementAmount = finalSettlementFor(price)` (all from the display price, unchanged), affiliate fields. Write an audit event (`action: 'ESCROW_HELD'`, actor `'RAZORPAY_ORDER'`).
- Return `{ success: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID, item: { id, craftType, artisanName } }`. **Never return the secret.**
- Error handling: Razorpay API error → 500; auth failure → surface as 500/401 with a clean message.

### 1.4 Backend — verify payment signature (marks the sale paid + records the buyer)
New route `src/app/api/payments/verify-payment/route.ts` (`POST`, `dynamic='force-dynamic'`):
- Body: `{ razorpay_order_id, razorpay_payment_id, razorpay_signature, craftItemId, buyerName?, buyerContact?, relatedDemandId? }`. Any missing signature field → 400.
- Verify with `verifyRazorpaySignature`. **On mismatch → 400 and do NOT mark paid.**
- On match, in a `$transaction`: set on the `CraftItem` — `razorpayPaymentId`, `razorpaySignature`, `paidAt = now`, `paidAmountPaise = DEMO_CHARGE_PAISE`, `status = 'SOLD'` (match the value the app already uses for sold items — check `seed.ts`/`getListingPrice`/`activityChip`; use the existing sold status, do not invent one), `salePrice = getListingPrice(item)` (display price, so earnings stay real), `productionStage = 'ACCEPTED'`, and record the buyer identity: `buyerName`, `buyerContact`, `relatedDemandId` (see Part 2). If `relatedDemandId` is present, also advance that `Demand.status` toward `MATCHED`/`FULFILLED` as appropriate. Write an audit event (`action: 'PAYMENT_VERIFIED'`).
- Return `{ success: true }` only when signatures match. Keep it idempotent (re-verifying the same payment must not double-write).

### 1.5 Frontend — Razorpay modal (replace the redirect)
In `src/app/marketplace/product/[id]/ProductClient.tsx`:
- Load the checkout script once: add `<Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />` (from `next/script`) — or inject it in a `useEffect` guard if `next/script` in a client component is awkward; either way load it exactly once and gate the buy button until it is ready.
- Rewrite `buyNow()`:
  1. POST to the create-order endpoint with `{ craftItemId, ref }`. Handle 503/409/500 with the existing `buyError` UI.
  2. Open the modal: `const rzp = new (window as any).Razorpay({ key: data.keyId, order_id: data.orderId, amount: data.amount, currency: data.currency, name: 'KARIGARI', description: item.craftType, image: <a public logo asset>, prefill: { name, contact, email } (collect a buyer name/contact first — reuse the buyer-name pattern or a tiny inline field), theme: { color: '#24332C' }, handler: async (resp) => { POST resp + craftItemId + buyerName/contact + relatedDemandId to /verify-payment; on success show a themed success state + route to My Orders or refresh; on failure show error }, modal: { ondismiss: () => setBuying(false) } });` then `rzp.on('payment.failed', ...)` to surface the error, then `rzp.open()`.
- Remove `window.location.href = data.url` and the Stripe redirect handling. Rename i18n key `buy_now_stripe` → `buy_now` (update all four locales and the usage). Update `?payment=success` handling in `src/app/marketplace/page.tsx`: with a modal there is no redirect, so success is handled in the `handler`; keep a graceful no-op for any stale query param.
- **Type safety:** add a minimal `Window.Razorpay` type (a `declare global` in the component or a `types/razorpay.d.ts`) so the build has no `any`/TS errors.

### 1.6 Clean up Stripe remnants
- Remove the `import Stripe from 'stripe'` and all Stripe usage. Grep `stripe`, `Stripe`, `STRIPE` across `src/`, `prisma/`, `.env*`, `next.config.ts` and remove/adjust each (comments in `escrow.ts`/`settle-escrow` that say "Stripe test mode" → reword to "Razorpay test mode"; the settlement narrative is unchanged). 
- Schema: keep the `stripeSessionId` column but stop writing it (or drop it in the migration — your call; if you drop it, ensure nothing reads it). Do not leave code writing a column you removed.

---

## PART 2 — Buyer "My Orders" tab + order tracking (single + bulk)

### 2.1 Schema additions (`model CraftItem`)
Add (nullable, non-breaking):
```prisma
razorpayOrderId   String?
razorpayPaymentId String?
razorpaySignature String?
paidAt            DateTime?
paidAmountPaise   Int?
buyerName         String?   // free-text buyer identity (same as Demand.buyerName)
buyerContact      String?
relatedDemandId   String?   // links a purchase back to the demand it fulfilled
@@index([buyerName])
@@index([relatedDemandId])
```
Migrate + `prisma generate`.

### 2.2 My Orders endpoint
New `GET /api/buyer/orders?buyer=<name>` (public, like the demand board): returns the buyer's purchased items — `CraftItem` rows where `buyerName` matches (case-insensitive) and `paidAt != null` — each with: id, craftType, image (guard falsy), `salePrice` (displayed), `paidAt`, `status`, `productionStage`, `escrowStatus`, `relatedDemandId`, and the derived stage ladder + timestamps needed by `OrderTimeline`. For **bulk** orders (a demand fulfilled by many items), group by `relatedDemandId` and return `unitsFulfilled / requested` and a **rate** (units/day since first ACCEPTED) — reuse the exact shape `/api/demand/track` already returns so `OrderTimeline` renders it unchanged.

### 2.3 My Orders UI
- Add a **tab switch at the top of `/buyer`** — "Demand Board" ⇄ "My Orders" — using the existing `SegmentedToggle` or `PillTabs` from `src/components/ui/SegmentedToggle.tsx` (matches theme; single-choice a11y). Default to the board. (Alternatively a `/buyer/orders` route — but the in-page tab is cleaner and shares the buyer-name state; prefer the tab.)
- **My Orders view:** list the buyer's paid orders, each a themed `Card` with the product image, title, artisan, amount paid (show the **displayed** price), order date, a status chip, and a **Flipkart/Amazon-style timeline** via `OrderTimeline` for the stage ladder (`PLACED → ACCEPTED → IN_PRODUCTION → QUALITY_CHECK → DISPATCHED → DELIVERED`, derived from `status`/`escrowStatus`/`qrVerified`/`productionStage`). For **bulk** orders show the fulfilment bar (`X of N units`, `ProgressBar`, units/day rate, projected completion) — the same pattern already used for demand tracking.
- Empty state: "No orders yet" with a themed illustration/CTA back to the board. Everything responsive to 360px; all strings in the four locale files.
- Wire the purchase → order link: when a buy starts from a demand match on `/buyer`, pass that `demandId` as `relatedDemandId` into create-order/verify so the purchased item shows up under the right demand in My Orders.

---

## §V — VERIFICATION PASS (run after implementing; fix every error before reporting done)

1. **Build & lint:** `npm run build` (Turbopack) must compile every route with **zero** TS errors (including the `window.Razorpay` typing); `npm run lint` clean; no leftover `stripe` import or unused var. `npx prisma generate` clean; migration applied.
2. **Secret hygiene:** grep the client bundle/components for `RAZORPAY_KEY_SECRET` and the literal secret — must appear **only** in server code / `.env`. `NEXT_PUBLIC_RAZORPAY_KEY_ID` only carries the key id.
3. **Runtime smoke (start `npm run dev`):**
   - Product page → **Buy** loads `checkout.js`, opens the Razorpay modal showing **₹1**, while the product page still displays the real price.
   - Complete a Razorpay **test** payment → `/verify-payment` returns success → item flips to sold, buyer recorded, audit event written.
   - Signature-mismatch path (tamper a field) → 400, item **not** marked paid.
   - Modal dismiss and `payment.failed` → clean error message, button re-enabled.
   - `/buyer` → **My Orders** tab shows the just-bought item with a working timeline; a bulk demand shows units + rate.
4. **Regression:** settle-escrow (`DISPATCH`/`DELIVERED`) still advances tranches; artisan earnings and escrow figures still show the **displayed** price, not ₹1; demand board + demand tracking unchanged.
5. **Report:** list every file created/modified, how to test (start server, click Pay, use Razorpay test card `4111 1111 1111 1111`, any future expiry, any CVV/OTP), and any manual step (e.g. adding the real keys to `.env`). Note explicitly that the real charge is ₹1 by design and where the one-line constant is to revert it.

**Manual steps to call out to the user:** the keys are already provided above; confirm they are in `.env` (not just `.env.example`). Razorpay **test mode** is used — no real money moves. If `npm install razorpay` fails due to no network in the environment, say so and stop rather than faking the integration.
