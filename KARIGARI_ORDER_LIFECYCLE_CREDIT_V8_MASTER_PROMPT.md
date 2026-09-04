# MASTER PROMPT — KARIGARI Demand-Order Lifecycle: Credit-on-Delivery (V8)

> Paste into **Claude Code** (it has this repo). **Read §1 first: most of this lifecycle is ALREADY built and working.** The one genuinely missing piece is crediting the artisan the **on-screen demand price** (not the ₹1 demo charge) once the buyer marks the order delivered, and surfacing that credit in the artisan's dashboard/earnings. Everything else in the request is verification + small polish. Do NOT rebuild what exists. Keep theme, i18n, build green; run §V at the end.

---

## 0. ORIENTATION

**App root:** `KARIGARI-main/KARIGARI/` — `cd` there. Next.js 16.3.1 (Turbopack), React 19.2, TS 5, Prisma 7.9 + adapter-pg. Prisma singleton `@/lib/prisma`; `npx prisma generate` + migration after schema edits. Money helpers `@/lib/pricing` (`getListingPrice`, `formatRupees`). i18n `useLanguage()` — new strings in all four `src/lib/i18n/{en,hi,or,te}.ts`. Theme tokens in `globals.css`.

**⚠️ Ground truth — verify each of these is present before changing anything (they should be):**

| Part of the request | Where it already lives | Status |
|---|---|---|
| Artisan sets deadline himself before accepting | `src/app/artisan/orders/page.tsx` (`deadlineDrafts`, `<input type="date">`, `getDeadlineDraft`, passed as `deadline` to POST) + `src/app/api/artisan/orders/route.ts` `parseDeadline()` (clamps 3–90 days) | **DONE** |
| Deadline reflected in buyer My Orders | `src/app/api/buyer/orders/route.ts` returns `artisanDeadline`; `src/components/BuyerOrders.tsx` renders it | **DONE** |
| Artisan daily progress updates | `src/app/api/artisan/orders/log/route.ts` (creates `OrderLog`) + page `addLog()` | **DONE** |
| Daily updates reflected to buyer | buyer/orders returns `dailyUpdates`; `BuyerOrders.tsx` renders them | **DONE** |
| "Complete" button + upload final image | artisan orders route `PATCH { action:'complete', completedImageUrl }` (image required, ≤2 MB) + page `openComplete`/`submitComplete` | **DONE** |
| Completed image shown to buyer | buyer/orders returns `completedImageUrl`; `BuyerOrders.tsx` renders it | **DONE** |
| Buyer "Delivered" button | `src/app/api/buyer/orders/delivered/route.ts` + `BuyerOrders.tsx` `markDelivered()` | **DONE** |
| Scan item + enter patch id + AI genuineness (3 checks) | `src/app/api/buyer/orders/verify/route.ts` (checks: `patchIdValid`, `productMatch` = Gemini Vision compare of the artisan's original `CraftItem.images[0]` vs the buyer's scanned photo ≥75, `artisanMatch` = patch's artisan owns the accepted `ArtisanOrder`) + `BuyerOrders.tsx` `VerifyForm`/`submitVerify` | **DONE** |
| **After delivered, credit the ON-SCREEN price (not ₹1) to the artisan's dashboard** | **NOWHERE — this is the gap** | **MISSING** |

**Data model (`prisma/schema.prisma`):** `Demand` has `deliveredAt`, `deliveryVerified`, `deliveryVerifiedAt`, `deliveryScanPatchId`, `deliveryScanScore`, `targetPriceMin/Max`, `artisanOrders ArtisanOrder[]`. `ArtisanOrder` has `artisanId`, `demandId`, `status` (ACCEPTED|IN_PROGRESS|COMPLETED|CANCELLED), `negotiatedPrice` (null = took listed price), `deadline`, `completedImageUrl`, `logs OrderLog[]`. **The on-screen/agreed price for a demand order = `ArtisanOrder.negotiatedPrice ?? Demand.targetPriceMax ?? Demand.targetPriceMin`.**

**Why the credit is missing:** artisan earnings everywhere are aggregated from `CraftItem` escrow fields (`advancePaid + finalPayoutQueued`, and `salePrice`) — see `src/app/api/artisan/orders/route.ts` `earnings` aggregate, `src/app/api/artisan/dashboard/route.ts`, and `src/app/artisan/earnings/page.tsx`. A demand fulfilled through the `ArtisanOrder` flow has **no** settled `CraftItem` row carrying the negotiated price, so `/api/buyer/orders/delivered` (which only sets `deliveredAt` + `status='FULFILLED'`) credits the artisan **nothing**. That is the whole task.

---

## 1. THE FEATURE TO BUILD — credit the on-screen price on delivery

### 1.1 Schema — record the credit on the order
Add to `model ArtisanOrder`:
```prisma
/// The on-screen demand price credited to the artisan when the buyer marks the
/// order delivered. This is the negotiated/agreed price shown on the demand —
/// NEVER the ₹1 demo charge Razorpay actually collected.
settledAmount   Float?
/// When that credit was recorded. Null until delivery; makes crediting idempotent.
settledAt       DateTime?
```
Migrate + `prisma generate`.

### 1.2 Credit at "Mark Delivered" (idempotent, in one transaction)
In `src/app/api/buyer/orders/delivered/route.ts`, when a demand is marked delivered, ALSO credit every accepted `ArtisanOrder` on that demand — inside the same `$transaction` that sets `deliveredAt`/`status='FULFILLED'`:
- For each `ArtisanOrder` where `demandId = demand.id` and `settledAt IS NULL`:
  - `settledAmount = order.negotiatedPrice ?? demand.targetPriceMax ?? demand.targetPriceMin ?? 0`
  - `settledAt = now`, `status = 'COMPLETED'`
  - Write an `AuditLog`-style record if a natural craftItem link exists; otherwise skip audit (AuditLog.craftItemId is a required FK, so do NOT write one without a real CraftItem). A console/log line is enough here.
- **Idempotent:** re-marking an already-delivered demand (the route already early-returns `alreadyDelivered`) must not credit twice — guard on `settledAt IS NULL`.
- Load `targetPriceMin/Max` in the `demand.findUnique` select (currently it only selects `id, buyerName, deliveredAt`).
- Return the credited total in the response (`creditedAmount`) so the buyer UI can optionally confirm, and so tests can assert it.

### 1.3 Surface the credit in the artisan's dashboard + earnings (denominated in the on-screen price)
The credited demand earnings are a **separate stream** from the CraftItem escrow ledger — add them, do not replace, and never double-count:
1. **`src/app/api/artisan/orders/route.ts`** — the stats `totalEarned` currently = `advancePaid + finalPayoutQueued`. Add a sum of `ArtisanOrder.settledAmount` (where `settledAt != null`) for this artisan and include it in `totalEarned` (or return it as `demandEarnings` and add both in the tile). 
2. **`src/app/api/artisan/dashboard/route.ts`** — wherever it computes `totalEarnings` / `totalGrossSales` / earnings tiles, add the artisan's `sum(ArtisanOrder.settledAmount where settledAt != null)` as a demand-fulfilment earnings line so the **dashboard reflects the credited on-screen price**.
3. **`src/app/artisan/earnings/page.tsx`** (+ `src/components/EarningsAnalytics.tsx` if present) — include settled demand orders in the totals and the monthly series (bucket by `settledAt`), labelled e.g. "Demand orders". The lump-sum total and monthly bars must include these credits. Keep using `formatRupees`.
- **Honesty rule (unchanged from the rest of the app):** the amount credited and displayed is the **on-screen demand price**; the ₹1 that Razorpay actually charged (`paidAmountPaise`) is never what earnings are denominated in. Keep any "test-mode / simulated settlement" framing consistent with `src/lib/escrow.ts`.

### 1.4 Small polish (only if quick and clearly missing after §V checks)
- **Buyer sees the credited/settled state:** if useful, have `/api/buyer/orders/route.ts` surface `settledAmount`/`settledAt` and let `BuyerOrders.tsx` show a subtle "Artisan paid" note after delivery. Optional — do not overbuild.
- **3-check wording vs the request:** the request lists the three checks as *(a) product image match, (b) patch id, (c) QR code from the image*. The route currently does *(a) product image match (Gemini Vision), (b) patchIdValid, (c) artisanMatch*. These already cover image + patch id; the "QR code" check is effectively the patch-id linkage (the patch id IS what the QR encodes — see the QR flow in `QrAttachModal.tsx`/`jsqr`). Leave the verify logic as-is unless §V shows it broken; if you want exact parity, relabel `artisanMatch` in the UI copy to make clear the QR/patch linkage is what's validated — a copy change only, not new AI calls.

---

## §V — VERIFICATION PASS (run after; fix everything before reporting done)

1. **Build & lint:** `npm run build` (Turbopack) zero TS errors; `npm run lint` clean; `npx prisma generate` clean; migration applied. New i18n keys in all four locales.
2. **End-to-end (start `npm run dev`):**
   - Buyer posts a demand → artisan Orders page shows it under matching demands → artisan **negotiates/accepts**, **picks a deadline** → the deadline shows in the buyer's My Orders.
   - Artisan adds a **daily update** (note + optional photo) → it appears in the buyer's My Orders.
   - Artisan clicks **Complete**, uploads the finished-product photo → buyer sees the completed image and a **Mark Delivered** button.
   - Buyer clicks **Mark Delivered** → demand `deliveredAt` set, `status=FULFILLED`, and **the artisan is credited the on-screen price** (`ArtisanOrder.settledAmount`/`settledAt` written).
   - Buyer runs **scan + patch id** → 3-check result renders (patch valid, product match, artisan/QR match).
3. **The credit is correct & idempotent:** the credited amount equals `negotiatedPrice ?? targetPriceMax ?? targetPriceMin` (the on-screen price), **not ₹1 / `paidAmountPaise`**. Marking delivered twice does **not** double-credit.
4. **Dashboard & earnings reflect it:** the artisan's dashboard total, the Orders-page `totalEarned` tile, and the Earnings page total + monthly chart all increase by the credited on-screen amount after delivery — with no double counting against the CraftItem escrow ledger.
5. **No regression:** existing marketplace Razorpay purchases (paid CraftItems) still show in buyer My Orders and still credit via the escrow ledger; the IVR/capture flow is untouched.
6. **Report:** list files changed, confirm the credited figure is the on-screen price (show the formula used), and confirm idempotency and no double-count.

**Guard-rails:** do not write an `AuditLog` row without a real `CraftItem` FK (it will throw). Do not add extra Gemini calls. Do not denominate any earnings in the ₹1 demo charge. Do not rebuild the artisan/buyer UI that already exists — this task is the credit path plus its reflection in earnings.
