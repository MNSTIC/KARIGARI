# KARIGARI — DEMAND & ORDER SYNCHRONISATION V9 MASTER PROMPT

> Three-stage execution workflow for Claude Code. Run PROMPT 1 to completion, then PROMPT 2, then PROMPT 3.
> Repo root for every path below: `KARIGARI/` (the Next.js app), not the outer folder.

---

## PROMPT 1 — PLANNING & ARCHITECTURE

You are a principal engineer working inside an existing Next.js 16.3.1 (App Router, React 19, TypeScript, Tailwind v4, Prisma 7 + PostgreSQL) codebase called KARIGARI — a marketplace that gives marginal artisans verifiable provenance, fair-pay floors and direct payouts. **Do not write feature code in this stage. Produce a written implementation blueprint and a schema diff only.**

### Read these files first, in this order, before proposing anything

Data + rules
- `prisma/schema.prisma` — models `Demand`, `ArtisanOrder`, `OrderLog`, `CraftItem`, `Notification`, `Ticket`, `ArtisanProfile`
- `src/lib/orderStage.ts` — the `ORDER_STAGES` ladder and `resolveStage()` derivation
- `src/lib/notifications.ts` — `craftMatchScore()`, `notifyArtisansForDemand()`
- `src/lib/buyerVerify.ts` — `verifyBuyerImage()`, `MIN_SIMILARITY`, the Gemini compare
- `src/lib/qrPatch.ts`, `src/lib/pricing.ts`, `src/lib/escrow.ts`, `src/lib/artisanHealth.ts`

Buyer surface
- `src/app/buyer/page.tsx` (tabs `board` | `orders`)
- `src/components/PostDemandModal.tsx` (the form being revamped)
- `src/components/DemandRecommendation.tsx`, `src/components/BuyerOrders.tsx`, `src/components/BuyerVerifyResult.tsx`
- `src/components/ui/OrderTimeline.tsx`, `src/components/ui/DemandRequestCard.tsx`, `src/components/QrScanModal.tsx`
- `src/app/buyer/verify/page.tsx`

Artisan surface
- `src/app/artisan/orders/page.tsx` (tabs `current` | `demands` — this IS the "Demands" tab in the artisan sidebar, `nav_orders`)
- `src/app/artisan/market/page.tsx` (its `buyers` tab duplicates the demand board read-only)
- `src/components/ui/Sidebar.tsx`, `src/components/NotificationsBell.tsx`, `src/components/QrAttachModal.tsx`

APIs
- `src/app/api/demand/route.ts` (GET/POST board), `src/app/api/demand/match/route.ts`, `src/app/api/demand/track/route.ts`, `src/app/api/demand/recommend/route.ts`
- `src/app/api/artisan/orders/route.ts` (GET/POST accept/negotiate, PATCH complete), `src/app/api/artisan/orders/log/route.ts`
- `src/app/api/buyer/orders/route.ts`, `src/app/api/buyer/orders/delivered/route.ts`, `src/app/api/buyer/orders/verify/route.ts`, `src/app/api/buyer/verify-item/route.ts`
- `src/app/api/payments/verify-payment/route.ts`, `src/app/api/artisan/notifications/route.ts`
- `src/lib/i18n/en.ts | hi.ts | or.ts | te.ts` and `src/lib/translations.ts`
- `src/app/globals.css` (design tokens: `--color-primary #1A1A1A`, `--color-maroon #5A1A1A`, `--color-rust #C2632F`, warm neutral grays, Fraunces/Inter/IBM Plex Mono)

### Confirm these defects before designing (they are the brief)

1. **Demand capture is thin.** `Demand` holds only craftType, quantity, price min/max, location, festival, buyerName, notes, one `referenceImageUrl`, material, color, description. Nothing structured for category, size/dimensions, customisation, required-by date, delivery mode, purchase type (individual/bulk/wholesale), or buyer flexibility. `PostDemandModal.tsx` is one flat scroll of inputs with no sections.
2. **Two competing sources of truth for fulfilment.** `/api/demand/track` derives progress from `Notification.relatedDemandId` + keyword-matched `CraftItem`s; `/api/buyer/orders` derives it from `ArtisanOrder` + `CraftItem.paidAt`. The buyer's Demand Board and My Orders tabs can therefore disagree about the same demand.
3. **No packing/dispatch state for demand orders.** `ArtisanOrder.status` is only `ACCEPTED | IN_PROGRESS | COMPLETED | CANCELLED`. `src/lib/orderStage.ts` derives DISPATCHED/DELIVERED from `CraftItem.escrowStatus`, which a demand order never has. "Packed and sent" is unrepresentable.
4. **"Mark complete" is unverified.** `PATCH /api/artisan/orders` with `action:"complete"` accepts any 2 MB image and flips status to COMPLETED. No QR, no patch check, no AI comparison — while the buyer's own later check (`/api/buyer/orders/verify` → `verifyBuyerImage`) does all three.
5. **No `ArtisanOrder → CraftItem` link.** `verifyBuyerImage`'s `artisanMatch` can only ask "does this patch's artisan hold *any* accepted order on this demand", not "is this the piece that was promised".
6. **The artisan is never told about a purchase.** `POST /api/payments/verify-payment` writes `CraftItem.buyerName`, `relatedDemandId`, `SOLD_FINAL` and an `AuditLog` — and creates **zero** `Notification` rows. Nothing tells the maker to pack anything.
7. **The buyer is never told anything.** Buyers have no `User` row (Prisma `Role` is `ADMIN | ARTISAN` only); identity is free-text `buyerName`. There is no buyer-side notification surface at all, so acceptance, daily updates, ready, dispatch and delivery are invisible until the buyer manually reloads and expands a card.
8. **Fan-out ignores most of the demand.** `notifyArtisansForDemand()` scores on `craftType` tokens alone — material, colour, location, quantity and the new structured fields are unused, and there is no per-artisan "why you were matched" signal.
9. **Daily updates have no cadence.** `OrderLog` rows exist and `/api/buyer/orders` returns `dailyUpdates`, but nothing tracks staleness, nudges the artisan, or notifies the buyer that an update landed.
10. **Duplicate demand UI.** `/artisan/market` `buyers` tab lists demands read-only with no accept path, competing with `/artisan/orders` `demands` tab.

### Deliver, as `docs/DEMAND_SYNC_V9_PLAN.md`

1. **Prisma diff** — exact new fields/models with comments in the house style (comments explain *why*, name the writer of each field, and never over-claim). Required additions:
   - `Demand`: `category`, `productType`, `sizeSpec`, `customizationRequired Boolean @default(false)`, `customizationDetails`, `referenceImageUrls String[]` (keep `referenceImageUrl` as the legacy first-image mirror), `requiredBy DateTime?`, `deliveryMode` (`DELIVERY|PICKUP`), `purchaseType` (`INDIVIDUAL|BULK|WHOLESALE`), `additionalRequirements`, and a flexibility block `flexBudget|flexColor|flexMaterial|flexDelivery` (`STRICT|FLEXIBLE`) + `flexDesign` (`EXACT|SIMILAR`).
   - `ArtisanOrder`: `craftItemId String?` + relation to `CraftItem` (the bound piece), `readyVerified Boolean @default(false)`, `readyImageUrl`, `readyScanPatchId`, `readySimilarityScore Float?`, `readyVerifiedAt`, `packedAt`, `dispatchedAt`, `courierName`, `trackingRef`, `lastLogAt DateTime?`, and an extended status vocabulary `ACCEPTED | IN_PROGRESS | READY | PACKED | DISPATCHED | DELIVERED | COMPLETED | CANCELLED`.
   - New `BuyerNotification` model keyed by free-text `buyerName` (case-insensitive lookups) with `demandId`, `artisanOrderId?`, `type` (`DEMAND_MATCHED|ORDER_ACCEPTED|DAILY_UPDATE|ORDER_READY|ORDER_PACKED|ORDER_DISPATCHED|ORDER_DELIVERED|PURCHASE_CONFIRMED`), `title`, `message`, `read`, `createdAt`, indexed `[buyerName, read]` and `[createdAt]`. Explain in the plan why a nullable-user `Notification` was rejected in favour of a separate model (buyer identity is not a user id and must never be joined as one).
   - Indexes for every new query path.
   - Migration note: this repo has **no `prisma/migrations/` directory** — state plainly that the change lands via `npx prisma db push` + `npx prisma generate`, and that every new column must be nullable or defaulted so existing rows survive.
2. **The one canonical lifecycle**, written as a state table: `Demand.status` (`OPEN → MATCHED → IN_PRODUCTION → FULFILLED | CANCELLED`) × `ArtisanOrder.status` × the buyer-visible `ORDER_STAGES` ladder. Say exactly which field each transition writes, which endpoint writes it, and which actor may trigger it. No stage may ever move backwards.
3. **Event map** — for each of the 8 sync events (demand posted, artisan accepted, daily update, ready+verified, packed, dispatched, buyer purchase, buyer delivered) name: trigger endpoint, DB writes, artisan `Notification` row, `BuyerNotification` row, and the UI that must re-render.
4. **The ready-verification design** — how `verifyBuyerImage()` in `src/lib/buyerVerify.ts` is generalised into a shared comparator so the artisan's ready-check and the buyer's delivery-check share one prompt, one `MIN_SIMILARITY`, one code path; what the artisan-side check adds (patch must resolve to a `CraftItem` owned by *this* artisan; that item becomes `ArtisanOrder.craftItemId`); and what happens on failure (no state change, actionable error, retry allowed, no health penalty for the artisan's own self-check).
5. **Matching upgrade** — how `craftMatchScore()` becomes a multi-signal score over craft + material + colour + category + location + capacity, what weights, and how "why you matched" is surfaced to the artisan without inventing a number when a signal is absent.
6. **Track unification** — how `/api/demand/track` is rewritten to read `ArtisanOrder` first and fall back to the notification-derived view only when no order exists, so it and `/api/buyer/orders` can never disagree.
7. **File-by-file work order** — every file to create or edit, in dependency order, with a one-line reason each.
8. **Risk list** — backward compatibility for rows written before V9, idempotency guards, the ₹1 demo-charge invariant (displayed price is `salePrice`/`getListingPrice`, never `paidAmountPaise`), and the honesty rules this codebase enforces (never claim a simulated payout was paid; never fabricate an AI score).

Constraints for the plan: no new npm dependencies; keep the existing design tokens and component kit; every user-visible string must be an i18n key present in all four dictionaries; no `middleware.ts` — per-route JWT guards via `requireArtisan()` stay the pattern; buyer routes stay public and identity-checked by case-insensitive `buyerName`.

---

## PROMPT 2 — IMPLEMENTATION

Implement `docs/DEMAND_SYNC_V9_PLAN.md` in the KARIGARI codebase. Production quality: typed, guarded, idempotent, themed, translated. Work in the order below and keep the app building after each numbered block.

### 0. Schema

Apply the planned diff to `prisma/schema.prisma`. Every new column nullable or defaulted. Run `npx prisma generate`. State in your output that `npx prisma db push` is required against a live `DATABASE_URL` before the app will run, and do not fabricate migration files.

### 1. Buyer "Raise a Demand" — revamp `src/components/PostDemandModal.tsx`

Rebuild the form as five labelled sections inside the existing modal shell (same rounded-3xl card, `bg-gray-50` header strip, sticky footer, `field`/`label` class constants, `kg-press` buttons, lucide icons). Keep it one scrollable modal with section headers — do not convert it into a multi-route wizard.

1. **Product requirements** — category select (Saree/Textile, Pottery & Ceramics, Jewellery, Handicraft, Painting & Art, Furniture, Home Décor, Metalwork, Leather, Other) driving a `productType` free-text with a datalist; `craftType` (required, existing); description textarea; quantity (required, ≥1); material (chips: Cotton, Silk, Wool, Wood, Clay, Metal, Leather, Bamboo, Other → free-text when Other); colour; design/pattern; size/dimensions (helper text: matters for furniture, décor, clothing); customisation Yes/No radio revealing a details textarea when Yes.
2. **Budget & purchase** — budget preset chips (₹500–1,000 / ₹1,000–5,000 / ₹5,000–10,000 / Custom) that write `targetPriceMin`/`targetPriceMax`, with Custom revealing the two existing numeric inputs; purchase type radio (Individual / Bulk / Wholesale); "when do you need it" radio (Flexible / Within 1 week / Within 1 month / Specific date) where the first three compute `requiredBy` and the fourth reveals a date input.
3. **Visual reference** — multi-image upload replacing the single-file input, **max 4 images, 2 MB each**, thumbnail grid with per-image remove, same `FileReader` → data-URL convention (there is no upload bucket). Client-side type and size validation before any POST, mirroring the server cap.
4. **Delivery** — delivery location (reuse `location`), preferred delivery date, Pickup/Delivery toggle.
5. **Flexibility + additional** — the flexibility matrix as five compact Strict/Flexible segmented rows (Design uses Exact/Similar-is-okay), each with a one-line explanation of what it lets the artisan propose; then the "Anything else the artisan should know?" textarea (`additionalRequirements`), with the existing `notes` field retained as internal notes or merged — pick one in the plan and be consistent.

Keep `<DemandRecommendation>` live-updating, now also fed `category`, `sizeSpec` and `purchaseType`. Keep the honesty footnote. Validation: inline, field-level, blocking submit with a single error summary — never a silent no-op. On success keep the existing `onPosted(demand, notified)` contract and show how many artisans were reached.

### 2. Demand API — `src/app/api/demand/route.ts`

Accept, trim, bound and persist every new field. Enum-guard `deliveryMode`, `purchaseType` and the five flexibility fields against allow-lists (unknown value → the safe default, never a 500). Validate `referenceImageUrls` as an array of ≤4 data-URL images ≤2 MB each with the existing regex; mirror `[0]` into legacy `referenceImageUrl`. Reject a `requiredBy` in the past. A rejected image must never fail the whole demand — keep that existing behaviour and report it back. GET must return the new fields and keep supporting `?id=`, `?status=`, `?craftType=`, `?limit=`.

### 3. Matching + fan-out — `src/lib/notifications.ts`

Replace the craft-only score with a weighted multi-signal score: craft tokens (dominant, keep the strong/weak token distinction), material, colour, category, location proximity (string match on `ArtisanProfile.location`/`clusterName`), and a capacity signal from the artisan's recent listing volume vs `Demand.quantity`. Return a breakdown `{ total, reasons: string[] }`, persist the reason string onto the created `Notification.message` (or a new column if the plan chose one) so the artisan sees *why* this demand reached them. Keep the existing idempotency (one notification per artisan per demand), the ≤25 recipient cap, and the swallow-all-SMS-errors behaviour. Extend `buildDemandSms()` input if the SMS line needs the new fields — keep it inside the SMS length budget.

### 4. Order lifecycle library — `src/lib/orderStage.ts`

Add `demandOrderStage(order: { status, readyVerified, packedAt, dispatchedAt, settledAt })` mapping `ArtisanOrder` state onto the same `ORDER_STAGES` vocabulary, plus `resolveDemandStage()` that takes the furthest of the demand-order stage and any bound `CraftItem`'s derived stage. Monotonic — never regress. Add the new i18n stage keys. Do not break `resolveStage()`'s existing callers.

### 5. Artisan ready-verification — the core of change 2

- Generalise `src/lib/buyerVerify.ts` into a shared comparator (extract `compareProductPhotos()` used by both flows) so the Gemini prompt, `MIN_SIMILARITY = 75`, the downscale-before-vision step and the fallback path exist once.
- New `POST /api/artisan/orders/verify-ready` (guard with `requireArtisan()`): body `{ orderId, patchId, scannedPatchId?, readyImageBase64 }`. It must (a) confirm the order belongs to the caller and is `ACCEPTED|IN_PROGRESS`; (b) resolve `patchId` to a `CraftItem` **owned by this artisan** — otherwise 403 with a clear message; (c) if a QR was scanned, require `scannedPatchId === patchId`; (d) run the shared comparator against that item's original capture photo; (e) **only on pass** write `craftItemId`, `readyVerified`, `readyImageUrl`, `readyScanPatchId`, `readySimilarityScore`, `readyVerifiedAt`, `status:'READY'` in one transaction, plus the `BuyerNotification`; (f) on fail change nothing, return the score and reasoning, allow retry, and apply no health penalty. Idempotent: a second pass on an already-READY order returns the stored result.
- New `PATCH` actions on `src/app/api/artisan/orders/route.ts`: `pack` (requires `readyVerified`), `dispatch` (requires packed; optional `courierName`, `trackingRef`). Keep the existing `complete` action but **gate it behind `readyVerified === true`** so the old unverified path can no longer mark an order done.
- UI: in `src/app/artisan/orders/page.tsx`, replace the current complete-modal with a **Ready → Verify** sheet that reuses `QrScanModal` (it already decodes patch QRs and captures a photo on one surface) — scan the patch, capture the finished piece, submit, show pass/fail with the score using the same visual language as `BuyerVerifyResult`. Then surface Pack and Dispatch as sequential actions with the courier/tracking inputs. Show the ladder on each order card with `OrderTimeline` or a compact stepper.

### 6. Purchase → artisan notification (missing link)

In `src/app/api/payments/verify-payment/route.ts`, inside the existing transaction (or immediately after, best-effort and non-fatal like the demand fan-out), create a `Notification` for `item.artisanId` of type `PURCHASE` carrying buyer name, piece, displayed price and a "pack and dispatch" call to action, and a `BuyerNotification` of type `PURCHASE_CONFIRMED`. If `relatedDemandId` is present, also bind/advance the matching `ArtisanOrder`. Never let a notification failure fail a verified payment.

### 7. Buyer notification surface

- New `GET /api/buyer/notifications?buyer=<name>` and `POST` (mark read) — public, case-insensitive `buyerName`, capped and paginated like the other buyer routes.
- Render as a bell/feed on `src/app/buyer/page.tsx` next to the existing tabs, styled like `src/components/NotificationsBell.tsx` but reading the buyer endpoint. Unread count badge. Clicking an entry deep-links to that order card.

### 8. Daily update system

- `src/app/api/artisan/orders/log/route.ts`: set `lastLogAt`, create a `BuyerNotification` of type `DAILY_UPDATE` (throttle to at most one per order per calendar day), and keep the existing ACCEPTED→IN_PROGRESS promotion.
- `GET /api/artisan/orders`: return `lastLogAt` and a `updateOverdue` boolean (no log in > 3 days on a non-terminal order). Show a persistent, non-blocking nudge card on the artisan orders page for overdue orders.
- `src/components/BuyerOrders.tsx`: show "Last update — N days ago" per order, an empty-state that is honest when the artisan has not posted yet, and the full log timeline with photos.

### 9. Track unification + buyer board

- Rewrite `src/app/api/demand/track/route.ts` to read `ArtisanOrder` (with logs and the bound `CraftItem`) as the primary source, keeping the notification-derived view only as the documented fallback when no order exists. Return the same `TrackPayload` shape `OrderTimeline` already consumes, plus the new ready/packed/dispatched timestamps and `dailyUpdates`.
- `src/app/api/buyer/orders/route.ts`: include `readyVerified`, `readyImageUrl`, `readySimilarityScore`, `packedAt`, `dispatchedAt`, `courierName`, `trackingRef`, `lastLogAt` and the bound `craftItemId` so the buyer card can show the whole chain.
- `src/app/api/buyer/orders/verify/route.ts` + `verifyBuyerImage()`: when the order has a bound `craftItemId`, require the scanned patch to resolve to **that** item, not merely to any item by that artisan. Keep the existing case-insensitive demand ownership check.
- `src/app/buyer/page.tsx`: show the new structured demand fields on each board card (category, size, customisation, purchase type, required-by, flexibility chips), keep the match panel and `matchScore` display honest about `scoredBy: 'text' | 'reference'`, and add a per-demand status pill driven by the unified lifecycle.

### 10. De-duplicate the artisan demand UI

Make `/artisan/market`'s `buyers` tab a read-only preview that deep-links each row to `/artisan/orders?tab=demands&demandId=<id>`, and have `src/app/artisan/orders/page.tsx` read that query param to scroll to and highlight the target demand. One accept path, one source of truth.

### 11. i18n

Every new string goes into `src/lib/i18n/en.ts` **and** `hi.ts`, `or.ts`, `te.ts`. Follow the existing key naming (`demand_*`, `orders_*`, `stage_*`, `buyer_*`). Provide real Hindi / Odia / Telugu translations, not English placeholders. Do not leave a key defined in one dictionary only.

### Engineering rules — non-negotiable

- Match the surrounding code exactly: `"use client"` only where needed, `export const dynamic = 'force-dynamic'` on every route handler that reads request state, `requireArtisan()` for artisan routes, `NextResponse.json` with real status codes, `try/catch` + `console.error` with a route-prefixed message.
- Comments explain **why**, in full sentences, in the voice already used in this repo. No banner comments, no restating the code.
- Theme: existing tokens only (`bg-primary`, `text-gray-*`, `--color-maroon`, `--color-rust`, `--color-mint`). No new colours, no new fonts, no bright accents. Mobile-first; every tap target ≥44px; `next/image` with `unoptimized` for data URLs.
- Money: displayed price is always `salePrice ?? getListingPrice(item)`; `paidAmountPaise` is the ₹1 demo charge and must never be presented as the order value. Never describe a `SIMULATED` payout as paid.
- AI: never fabricate a score. When Gemini is unconfigured or fails, say which path ran (`scoredBy`, fallback reasoning) exactly as the existing code does.
- Every mutating endpoint idempotent and guarded against double-submit; every state machine monotonic.
- No new dependencies. No `any`. No unused imports. No `console.log` left in UI components.

---

## PROMPT 3 — REVIEW, TESTING & OPTIMISATION

Audit the V9 implementation across the whole KARIGARI codebase. Report findings as a table (file · line · severity · defect · fix), then apply every Critical and High fix and re-verify. Do not declare done on partial work.

### A. Build and type gates — run these, paste real output

```
npx prisma generate
npx tsc --noEmit
npm run lint
npm run build
```

Zero TypeScript errors, zero ESLint errors, a clean production build. If `npm run build` needs a database, say so explicitly rather than skipping the gate silently.

### B. Full-file sweep

Open **every** file created or edited, plus every file that imports them, and confirm:
- no leftover references to removed props, fields or endpoints
- no orphaned state, unused imports, or dead branches from the old complete-flow
- `prisma/schema.prisma` and every `select:`/`include:` agree — no field selected that does not exist, none silently dropped
- `src/lib/i18n/en.ts` key set === `hi.ts` === `or.ts` === `te.ts`; write and run a throwaway script to diff the four key sets and paste the result
- every `t("...")` call in changed files resolves to a real key

### C. End-to-end trace — walk the code, not the UI, and prove each hop

1. Buyer posts a demand with all new fields, 3 reference images, Strict budget / Similar design → row written with every field → `notifyArtisansForDemand` fans out → matching artisans get a `Notification` with a real reason → non-matching artisans get none.
2. That demand appears in `/artisan/orders` `demands` tab **for the matching artisan only**, with the buyer's photos, size, customisation and flexibility visible before acceptance.
3. Artisan accepts (and negotiates) → `ArtisanOrder` created, `Demand.status → MATCHED`, `BuyerNotification` written, buyer's board and My Orders both reflect it **and agree with each other**.
4. Artisan posts a daily update → `OrderLog` + `lastLogAt` + one throttled `BuyerNotification` → visible in `BuyerOrders` with photo and relative time.
5. No update for 4 days → `updateOverdue` true → nudge renders on the artisan page and the buyer card shows the honest staleness line.
6. Artisan marks Ready → QR scan + photo → wrong patch rejected (403, no state change); another artisan's patch rejected; low-similarity photo rejected with the real score and retry allowed; correct patch + photo passes → `craftItemId` bound, `readyVerified`, `status READY`, buyer notified.
7. Pack → Dispatch with courier/tracking → each writes its timestamp, notifies the buyer, and advances the ladder monotonically. Verify Pack is impossible before Ready and Dispatch impossible before Pack.
8. Buyer purchase through Razorpay → `verify-payment` → artisan receives a `PURCHASE` notification → buyer receives `PURCHASE_CONFIRMED` → displayed value is the listing price, never ₹1.
9. Buyer marks delivered → demand `FULFILLED`, every uncredited `ArtisanOrder` credited exactly once at the agreed price, artisan notified; a second click credits nothing more.
10. Buyer scan-verifies → with a bound `craftItemId`, a different piece by the same artisan now fails `artisanMatch`; the correct piece passes and awards health exactly once.

For each hop state: the endpoint, the rows written, the notifications created, and the components that re-render.

### D. Concurrency, security, edge cases

- Double-click every mutating button: accept, ready-verify, pack, dispatch, complete, mark-delivered, add-log. Prove no duplicate rows and no double credits (`updateMany` with a null-guard predicate, or an equivalent).
- Cross-tenant: artisan A cannot verify, pack, dispatch, complete or log against artisan B's order (403 on every path). Buyer "X" cannot mark buyer "Y"'s demand delivered or read Y's notifications.
- Data-URL limits enforced on the client **and** the server for all four upload paths (reference images ×4, order log, ready photo, buyer verify photo).
- Enum guards reject junk without a 500; `requiredBy` in the past rejected; quantity/price bounds held.
- Legacy rows written before V9 (null `referenceImageUrls`, null `craftItemId`, old statuses) render and transition without crashing — check every `.map`, `.length` and non-null assertion on the new fields.
- Gemini unconfigured / rate-limited: ready-verify and buyer-verify both degrade exactly as the existing code documents, and the UI says which path ran.
- No secret, patch ID, contact number or artisan PII leaks through a public buyer route.

### E. Performance

- No N+1: demand fan-out, `/api/buyer/orders`, `/api/demand/track` and `/api/artisan/orders` must each use batched queries with `in:` — flag any query inside a loop.
- Every new query path has a supporting index in `prisma/schema.prisma`.
- Images downscaled before any Gemini call (`prepareForVision`); vision candidates still capped; the 12s vision timeout still honoured.
- `PostDemandModal` does not re-render the whole form per keystroke; the recommendation call stays debounced.

### F. UX and accessibility

- Every new control has a label, an accessible name, keyboard operability and a visible focus ring; modals trap focus and close on Escape.
- Loading, empty, error and offline states exist for every new surface — no bare spinners, no dead ends.
- Theme audit: screenshot-level check that no new colour, radius, shadow or font escaped the token set, and that everything reads correctly at 360px width.

### G. Documentation

- Update `ARCHITECTURE.md` — it is materially out of date (it still claims no Razorpay, no buyer surface, `/artisan/market` as a stub). Correct the buyer and artisan workflow sections and the status-machine diagram to the V9 lifecycle.
- Update `docs/CONTRACT.md` and `docs/KARIGARI_FLOWCHARTS.md` with the new endpoints and the unified state table.
- Append a short "V9 — demand & order synchronisation" section to `README.md` listing the new env-free setup steps (`prisma db push`, `prisma generate`, `npm run seed`).

### H. Final report

Output: gates run with real output · findings table with what was fixed · the trace results for all 10 hops · anything deliberately left undone with the reason. Do not claim a hop verified that you did not actually trace in the code.
