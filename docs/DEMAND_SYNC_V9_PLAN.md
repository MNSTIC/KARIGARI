# V9 — Demand & Order Synchronisation

Implementation blueprint. No feature code lands from this document; PROMPT 2 does that.

Repo root for every path: `KARIGARI/`.

---

## 0. Defects, verified against the code

Each line below was checked in the file named, not inferred from the brief.

| # | Defect | Verified where |
|---|---|---|
| 1 | `Demand` carries no category, product type, size, customisation, required-by, delivery mode, purchase type or flexibility. `PostDemandModal` is one `space-y-4` scroll with no section headers. | `prisma/schema.prisma` (`model Demand`), `src/components/PostDemandModal.tsx` |
| 2 | Two fulfilment truths. `/api/demand/track` counts `CraftItem`s belonging to artisans who merely *received a notification*, keyword-matched on craft. `/api/buyer/orders` counts only `CraftItem`s with `paidAt` set, grouped by `relatedDemandId`. The same demand can read "3 fulfilled" on the board and "0" in My Orders. | `src/app/api/demand/track/route.ts`, `src/app/api/buyer/orders/route.ts` |
| 3 | `ArtisanOrder.status` is `ACCEPTED \| IN_PROGRESS \| COMPLETED \| CANCELLED`. `resolveStage()` derives DISPATCHED/DELIVERED from `CraftItem.escrowStatus`, and a demand order has no `CraftItem` at all — so it can never render past ACCEPTED. "Packed and sent" is unrepresentable. | `prisma/schema.prisma` (`model ArtisanOrder`), `src/lib/orderStage.ts` |
| 4 | `PATCH /api/artisan/orders` with `action:"complete"` validates only that the body carries a ≤2 MB `data:image/...` URL, then `updateMany` → `COMPLETED`. No QR, no patch resolution, no AI compare. | `src/app/api/artisan/orders/route.ts` (PATCH handler) |
| 5 | `verifyBuyerImage()`'s `artisanMatch` is `artisanOrder.findFirst({ demandId, artisanId })` — "does this artisan hold *any* order on this demand", never "is this the promised piece". | `src/lib/buyerVerify.ts` |
| 6 | `POST /api/payments/verify-payment` writes `CraftItem` fields, advances `Demand.status`, and calls `logCraftItemEvent`. It creates **zero** `Notification` rows. | `src/app/api/payments/verify-payment/route.ts` (the `$transaction`) |
| 7 | Prisma `Role` is `ADMIN \| ARTISAN`. Buyer identity is free-text `buyerName` on `Demand` / `CraftItem` / `Review` / `Ticket`. There is no buyer notification model, endpoint or surface anywhere. | `prisma/schema.prisma`; `grep -r "buyer/notifications" src` → no hits |
| 8 | `notifyArtisansForDemand()` scores with `craftMatchScore(profile.craftType, demand.craftType)` only. `material`, `color`, `location`, `quantity` are read for the SMS body but never for ranking, and no per-artisan reason is stored. | `src/lib/notifications.ts` |
| 9 | `OrderLog` rows exist and `/api/buyer/orders` returns `dailyUpdates`, but nothing records the last log time, nothing computes staleness, nothing nudges, nothing notifies. | `src/app/api/artisan/orders/log/route.ts`, `prisma/schema.prisma` (`model OrderLog`) |
| 10 | `/artisan/market` `buyers` tab lists `OPEN` demands read-only; its only CTA is `<Link href="/artisan/insights">`. The accept path lives on `/artisan/orders` `demands`. | `src/app/artisan/market/page.tsx` |

**Three further findings the brief did not list, confirmed and carried into the risk list:**

- **F11 — the buyer's "Pay advance" button is pure local state.** `src/app/buyer/page.tsx` drives `quoteState` between `pending → quoted → accepted → paid` with `setQuoteState` and no network call at all, then renders `t("advance_paid_confirmation")`. Nothing is charged and nothing is recorded. This is the honesty rule ("never claim a simulated payout was paid") being broken on the buyer's own screen.
- **F12 — the i18n dictionaries are already out of sync.** `en.ts` holds 987 keys; `hi.ts`, `or.ts` and `te.ts` hold 926 each, all three missing the same 61 keys (`scan_and_verify`, `qr_match`, the whole `report_*` / `tickets_*` / `trust_*` families). V9 must not add to that debt, and §11 of PROMPT 2 folds the repair in.
- **F13 — `ArtisanOrder.completedImageUrl` is fetched by the buyer and dropped by the artisan.** `/api/buyer/orders` returns it; `GET /api/artisan/orders` maps orders by hand and omits it, while `src/app/artisan/orders/page.tsx` declares `completedImageUrl?: string | null` on `ArtisanOrderRow`. The field is permanently `undefined` on the artisan side.

Also noted: `Demand.status`'s doc-comment says `OPEN | MATCHED | FULFILLED` but `POST /api/artisan/orders` rejects `CANCELLED` as though it existed. Nothing writes `CANCELLED` to a demand anywhere. V9 adds it to the vocabulary without adding a writer, and says so.

---

## 1. Prisma diff

### 1.1 House style: `String` columns, not Postgres enums

Every status vocabulary in this schema except `Role` is a `String` with a doc-comment listing the values and an allow-list guard at the API layer — `CraftItem.status`, `ArtisanOrder.status`, `Ticket.status`, `ResourceRequest.status`, `CraftItem.escrowStatus`, `CraftItem.payoutMode`. V9 follows that. A real `enum` would be defensible on a greenfield schema, but mixing the two conventions in one file makes the reader guess which columns are guarded where, and `db push` against a live database with existing rows is a bad place to discover an enum cast failure.

### 1.2 `model Demand` — additions

```prisma
  /// Top-level craft family the buyer picked from the form's fixed list
  /// ("Saree & Textile", "Pottery & Ceramics", …). Distinct from `craftType`,
  /// which stays the buyer's own words: the category is what the matcher can
  /// compare across artisans, the craftType is what the artisan reads.
  category               String?
  /// The specific article inside that category ("Dupatta", "Dinner set").
  /// Free text with a datalist, so a buyer is never blocked by a missing option.
  productType            String?
  /// Dimensions in the buyer's own words — "6.3 m x 1.1 m", "18 inch tall".
  /// Deliberately unparsed: a furniture buyer and a saree buyer do not share a
  /// unit, and guessing one wrong is worse than showing the artisan the string.
  sizeSpec               String?
  /// Whether the buyer wants something made to their spec rather than off the
  /// shelf. Defaulted rather than nullable so every legacy row reads "no",
  /// which is what those rows actually meant.
  customizationRequired  Boolean  @default(false)
  /// Only meaningful when `customizationRequired`. Never shown otherwise.
  customizationDetails   String?
  /// Up to four reference photos, data URLs like every other image in this
  /// schema. Written by POST /api/demand.
  referenceImageUrls     String[]
  /// When the buyer needs the goods in hand. Null means "flexible" — the form
  /// offers that explicitly, so null is a choice here, not missing data.
  requiredBy             DateTime?
  /// DELIVERY | PICKUP. Guarded against an allow-list in POST /api/demand;
  /// an unknown value falls back to DELIVERY rather than 500ing.
  deliveryMode           String   @default("DELIVERY")
  /// INDIVIDUAL | BULK | WHOLESALE. Drives the capacity signal in the matcher.
  purchaseType           String   @default("INDIVIDUAL")
  /// "Anything else the artisan should know?" — the artisan-facing free text
  /// that replaces `notes` on the form. See the note on `notes` below.
  additionalRequirements String?

  // Flexibility matrix. What the artisan is allowed to propose instead of what
  // the buyer literally asked for. Every one defaults to the stricter reading,
  // so a legacy row is never treated as more permissive than the buyer was.
  /// STRICT | FLEXIBLE
  flexBudget             String   @default("STRICT")
  /// STRICT | FLEXIBLE
  flexColor              String   @default("STRICT")
  /// STRICT | FLEXIBLE
  flexMaterial           String   @default("STRICT")
  /// STRICT | FLEXIBLE
  flexDelivery           String   @default("STRICT")
  /// EXACT | SIMILAR
  flexDesign             String   @default("EXACT")

  buyerNotifications     BuyerNotification[]
```

> **Corrected during the PROMPT 3 audit.** The plan originally added
> `@@index([buyerName])` and `@@index([category])` here. Neither shipped: nothing
> filters a `Demand` by either column — the buyer's board fetches the whole board
> and narrows by name in React, and `category` is read off an already-loaded row
> rather than searched on. The same audit dropped `[artisanId, status]` and
> `[lastLogAt]` from `ArtisanOrder` for the same reason. `[craftItemId]` stayed:
> it is a foreign key, and Postgres does not index those on its own.

`referenceImageUrl` **stays**, as the legacy first-image mirror. `POST /api/demand` writes `referenceImageUrls[0]` into it on every new row, so every existing reader (`DemandRequestCard`, `/api/demand/match`'s vision pass, the artisan demand list, the buyer board card) keeps working untouched. New readers prefer `referenceImageUrls` and fall back to `[referenceImageUrl].filter(Boolean)`.

**Decision on `notes` vs `additionalRequirements` — the brief asks for one, and consistency.** The form drops the `notes` field. `additionalRequirements` becomes the single artisan-facing free-text box. The `notes` **column stays**, because seeded and demo rows carry content in it and the buyer board already renders it publicly (`{demand.notes}` in `src/app/buyer/page.tsx`), so dropping it would blank live cards. Every render site becomes `additionalRequirements ?? notes`. `notes` is never written again after V9.

### 1.3 `model ArtisanOrder` — additions

```prisma
  /// The specific piece this order was fulfilled with, bound at ready-check
  /// time by /api/artisan/orders/verify-ready. Before V9 there was no link at
  /// all, so `verifyBuyerImage` could only ask "does this patch's artisan hold
  /// an order on this demand" — never "is this the piece that was promised".
  craftItemId          String?
  craftItem            CraftItem? @relation(fields: [craftItemId], references: [id])

  // ---- Ready verification. Written ONLY on a passing check, in one
  // transaction, by /api/artisan/orders/verify-ready. A failed check writes
  // nothing at all, so these fields never describe an attempt that did not pass.
  readyVerified        Boolean   @default(false)
  /// The artisan's photo of the finished piece that passed the comparison.
  readyImageUrl        String?
  /// The patch id that resolved to `craftItemId`. Kept so a later dispute can
  /// see which sticker the artisan actually scanned.
  readyScanPatchId     String?
  /// 0–100 from the shared comparator. Null when no check has passed — never a
  /// placeholder number.
  readySimilarityScore Float?
  readyVerifiedAt      DateTime?

  /// Set by PATCH action:"pack". Requires `readyVerified`.
  packedAt             DateTime?
  /// Set by PATCH action:"dispatch". Requires `packedAt`.
  dispatchedAt         DateTime?
  courierName          String?
  trackingRef          String?

  /// When the artisan last posted an OrderLog. Mirrored rather than derived so
  /// the overdue query is a column comparison instead of a per-order subquery.
  lastLogAt            DateTime?

  buyerNotifications   BuyerNotification[]

  @@index([craftItemId])
```

`ArtisanOrder.status`'s doc-comment becomes:

```
  /// ACCEPTED | IN_PROGRESS | READY | PACKED | DISPATCHED | DELIVERED |
  /// COMPLETED | CANCELLED. Monotonic — see src/lib/orderStage.ts. Set at the
  /// API layer; every writer is named in docs/DEMAND_SYNC_V9_PLAN.md §2.
```

`model CraftItem` gains the back-relation only:

```prisma
  artisanOrders       ArtisanOrder[]
```

### 1.4 New `model BuyerNotification`

```prisma
/// One alert for one buyer.
///
/// Deliberately NOT a nullable-user `Notification`. `Notification.userId` is a
/// required FK onto `User`, and buyers have no `User` row — Prisma `Role` is
/// ADMIN | ARTISAN and nothing in this app creates a buyer account. Making that
/// column nullable would mean every existing artisan query (`where: { userId }`,
/// the unread count, the mark-all-read `updateMany`) starts scanning rows that
/// can never belong to an artisan, and one missing `userId: { not: null }` guard
/// would leak a buyer's alerts into an artisan's bell. Worse, it would put a
/// free-text name in a column whose name and type promise a user id — exactly
/// the kind of join a later reader makes by accident.
///
/// A separate model keeps the two identity models apart at the type level: this
/// table has no `userId` to misuse, and the artisan table has no `buyerName`.
model BuyerNotification {
  id             String        @id @default(uuid())
  /// Free-text buyer identity, the same convention Demand.buyerName,
  /// CraftItem.buyerName, Review.buyerName and Ticket.buyerName already use.
  /// Looked up case-insensitively, because it is typed by hand each visit.
  buyerName      String
  demandId       String
  demand         Demand        @relation(fields: [demandId], references: [id])
  /// Null for events that belong to the demand rather than one artisan's
  /// commitment — DEMAND_MATCHED, and a storefront PURCHASE_CONFIRMED.
  artisanOrderId String?
  artisanOrder   ArtisanOrder? @relation(fields: [artisanOrderId], references: [id])
  /// DEMAND_MATCHED | ORDER_ACCEPTED | DAILY_UPDATE | ORDER_READY |
  /// ORDER_PACKED | ORDER_DISPATCHED | ORDER_DELIVERED | PURCHASE_CONFIRMED
  type           String
  title          String
  message        String
  read           Boolean       @default(false)
  createdAt      DateTime      @default(now())

  @@index([buyerName, read])
  @@index([createdAt])
  @@index([demandId])
  @@index([artisanOrderId])
}
```

**Index honesty.** `@@index([buyerName, read])` is a plain btree, and every lookup in this app uses `{ equals: buyer, mode: 'insensitive' }`, which Postgres cannot serve from it — the planner will sequential-scan. That is already true of `CraftItem.buyerName` and `Ticket.buyerName`, so V9 stays consistent rather than inventing a third convention. The upgrade path, when row counts justify it, is a lowercased mirror column (`buyerNameKey`) written at insert and matched exactly. It is not worth adding now, and this plan does not pretend the index is doing work it is not.

### 1.5 Migration note

**This repo has no `prisma/migrations/` directory.** `ls prisma` returns `schema.prisma` and `seed.ts` and nothing else, even though `prisma.config.ts` points `migrations.path` at `prisma/migrations`. The V9 schema change therefore lands as:

```bash
npx prisma db push
npx prisma generate
```

against a live `DATABASE_URL`. **No migration SQL files will be fabricated.** Two consequences the implementation must honour:

1. Every new column is nullable or defaulted, so `db push` never proposes to drop and recreate a table. §8/R1 audits each one against that rule.
2. Prisma scalar lists are `NOT NULL DEFAULT ARRAY[]::text[]`, so `Demand.referenceImageUrls` reads as `[]` on legacy rows, not `null`. Code still uses `?? []`, because a stale generated client or a hand-written raw query can hand back `undefined`.

Per this project's recorded setup, a bare `db push` hangs on the pooled connection — run it as `npx prisma db push --url "$DIRECT_URL"`.

---

## 2. The one canonical lifecycle

### 2.1 Rank functions (both monotonic, both in `src/lib/orderStage.ts`)

```
DEMAND_STATUSES = ['OPEN', 'MATCHED', 'IN_PRODUCTION', 'FULFILLED']   // CANCELLED terminal, off-ladder
ORDER_STATUSES  = ['ACCEPTED', 'IN_PROGRESS', 'READY', 'PACKED',
                   'DISPATCHED', 'DELIVERED', 'COMPLETED']            // CANCELLED terminal, off-ladder
```

Every write goes through `advanceDemandStatus(current, next)` / `advanceOrderStatus(current, next)`, which return `current` when `rank(next) <= rank(current)`. No endpoint writes a status literal directly.

### 2.2 The state table

| Transition | `Demand.status` | `ArtisanOrder.status` | Buyer ladder (`ORDER_STAGES`) | Endpoint that writes it | Actor |
|---|---|---|---|---|---|
| Buyer posts | `OPEN` | — | `PLACED` | `POST /api/demand` | buyer (public) |
| Artisan accepts / negotiates | `OPEN → MATCHED` | *(create)* `ACCEPTED` | `ACCEPTED` | `POST /api/artisan/orders` | artisan (`requireArtisan`) |
| Artisan posts first log | `MATCHED → IN_PRODUCTION` | `ACCEPTED → IN_PROGRESS` | `IN_PRODUCTION` | `POST /api/artisan/orders/log` | artisan |
| Artisan posts a later log | — | — | — | same | artisan |
| Ready-check passes | — | `→ READY` + `craftItemId`, `readyVerified`, `readyImageUrl`, `readyScanPatchId`, `readySimilarityScore`, `readyVerifiedAt` | `QUALITY_CHECK` | `POST /api/artisan/orders/verify-ready` | artisan |
| Ready-check fails | — | **unchanged** | unchanged | same | artisan |
| Artisan packs | — | `READY → PACKED` + `packedAt` | `QUALITY_CHECK` | `PATCH /api/artisan/orders` `action:"pack"` | artisan |
| Artisan dispatches | — | `PACKED → DISPATCHED` + `dispatchedAt`, `courierName?`, `trackingRef?` | `DISPATCHED` | `PATCH …` `action:"dispatch"` | artisan |
| Artisan closes the job | — | `DISPATCHED\|DELIVERED → COMPLETED` + `completedImageUrl`, **requires `readyVerified === true`** | unchanged | `PATCH …` `action:"complete"` | artisan |
| Buyer pays for a matched piece | `→ MATCHED`, or `→ FULFILLED` when `count(paid CraftItem) >= quantity` | binds `craftItemId` if null; `ACCEPTED → IN_PROGRESS` | derived from the `CraftItem` | `POST /api/payments/verify-payment` | buyer (post-HMAC) |
| Buyer marks delivered | `→ FULFILLED` + `deliveredAt` | `→ DELIVERED` + `settledAmount` + `settledAt`, guarded `settledAt: null` | `DELIVERED` | `POST /api/buyer/orders/delivered` | buyer (name-matched) |
| Buyer scan-verifies | `deliveryVerified`, `deliveryVerifiedAt`, `deliveryScanPatchId`, `deliveryScanScore` | — | — | `POST /api/buyer/orders/verify` · `POST /api/buyer/verify-item` | buyer |
| Cancellation | `→ CANCELLED` | `→ CANCELLED` | ladder replaced by a CANCELLED pill | **no writer exists** | — |

**`CANCELLED` has no writer, deliberately.** It is in both vocabularies because `POST /api/artisan/orders` already refuses an acceptance against a `CANCELLED` demand, and rows can arrive from a future admin tool or a manual DB fix. Every reader must handle it; nothing in V9 creates it, and the implementation must not invent a cancel button to justify the value.

**`DELIVERED` vs `COMPLETED` — exactly one writer each.** `DELIVERED` is the buyer's acknowledgement (and the credit). `COMPLETED` is the artisan's own closing acknowledgement, allowed only from `DISPATCHED` or `DELIVERED`. Both are terminal for "current orders" filtering — which means `src/app/artisan/orders/page.tsx` must widen `status !== "COMPLETED" && status !== "CANCELLED"` to also exclude `DELIVERED`, or a delivered-and-credited order sits in the artisan's active list forever.

### 2.3 `ORDER_STAGES` is not extended

The ladder stays six rungs: `PLACED · ACCEPTED · IN_PRODUCTION · QUALITY_CHECK · DISPATCHED · DELIVERED`.

Adding a `PACKED` rung would insert a step into **every** `CraftItem` timeline too — including plain storefront purchases, which have no pack step and would show a permanently-pending rung between quality check and dispatch. Instead, `READY` and `PACKED` both map to `QUALITY_CHECK`, and their timestamps render as sub-labels on that rung (`stage_ready`, `stage_packed`). The artisan's own compact stepper is a different component with a different job and shows all eight states.

This is why `resolveStage()` and its callers need no change at all.

### 2.4 `demandOrderStage()` mapping

| `ArtisanOrder` state | `OrderStage` |
|---|---|
| `settledAt` set, or `COMPLETED`, or `DELIVERED` | `DELIVERED` |
| `dispatchedAt` set, or `DISPATCHED` | `DISPATCHED` |
| `packedAt` set, or `readyVerified`, or `PACKED` / `READY` | `QUALITY_CHECK` |
| `IN_PROGRESS`, or any `OrderLog` exists | `IN_PRODUCTION` |
| `ACCEPTED` | `ACCEPTED` |
| no order | `PLACED` |

`resolveDemandStage(order, item?)` returns the furthest of `demandOrderStage(order)` and, when a `CraftItem` is bound, `resolveStage(item)` — the same "take the furthest of proven and declared" rule `resolveStage` already uses internally. `CANCELLED` is not mapped: the card renders a cancelled pill instead of a ladder.

---

## 3. Event map

Eight events. For each: trigger, DB writes, artisan `Notification`, `BuyerNotification`, UI that must re-render.

### E1 — Demand posted
- **Trigger:** `POST /api/demand`
- **DB:** one `Demand` row with every new field; `referenceImageUrls[0]` mirrored to `referenceImageUrl`.
- **Artisan `Notification`:** one `DEMAND_ALERT` per matched artisan (≤25), `relatedDemandId` set, `message` = `demandAlertMessage()` + the match-reason line, `channel` `WHATSAPP`/`IN_APP` then corrected to `SMS` on send. Idempotent per `(userId, relatedDemandId)`.
- **`BuyerNotification`:** one `DEMAND_MATCHED`, written only when `fanout.created > 0`, titled with the recipient count. When nobody matched, no row — an empty board is not an event.
- **Re-renders:** buyer `/buyer` board list + toast; artisan bell (`NotificationsBell`), `/artisan/orders` `demands` tab, `/artisan/market` `buyers` tab.

### E2 — Artisan accepted (or negotiated)
- **Trigger:** `POST /api/artisan/orders` `{ action: 'accept' | 'negotiate' }`
- **DB:** `ArtisanOrder` created (`ACCEPTED`, `negotiatedPrice?`, `deadline`); `Demand.status` advanced to `MATCHED`.
- **Artisan `Notification`:** none. The artisan performed the action; telling them about it is noise.
- **`BuyerNotification`:** `ORDER_ACCEPTED`, carrying artisan name, quantity, agreed price and deadline.
- **Re-renders:** `/artisan/orders` both tabs; buyer bell, `/buyer` board status pill, `BuyerOrders` card.
- **Idempotency:** the existing `findFirst({ artisanId, demandId })` short-circuit returns `{ idempotent: true }` and must **not** write a second `BuyerNotification`.

### E3 — Daily update
- **Trigger:** `POST /api/artisan/orders/log`
- **DB:** `OrderLog` row; `ArtisanOrder.lastLogAt = now`; `ACCEPTED → IN_PROGRESS`; `Demand.status` advanced to `IN_PRODUCTION`.
- **Artisan `Notification`:** none.
- **`BuyerNotification`:** `DAILY_UPDATE`, **throttled to one per order per calendar day (IST)**. The throttle is a `findFirst` on `(artisanOrderId, type: 'DAILY_UPDATE', createdAt >= startOfTodayIST)` inside the same transaction. A second log the same day still writes the `OrderLog` — the artisan's record is never suppressed, only the buyer's ping.
- **Re-renders:** `/artisan/orders` log timeline; `BuyerOrders` "Live production updates" and the "Last update — N days ago" line; buyer bell.

### E4 — Ready + verified
- **Trigger:** `POST /api/artisan/orders/verify-ready`
- **DB (only on pass, one transaction):** `craftItemId`, `readyVerified: true`, `readyImageUrl`, `readyScanPatchId`, `readySimilarityScore`, `readyVerifiedAt`, `status → READY`.
- **Artisan `Notification`:** none.
- **`BuyerNotification`:** `ORDER_READY`, quoting the similarity score and naming which path produced it.
- **On failure:** nothing written, no notification, no health penalty, retry allowed.
- **Re-renders:** `/artisan/orders` card stepper and the ready sheet's result panel; `BuyerOrders` ladder; buyer bell.

### E5 — Packed
- **Trigger:** `PATCH /api/artisan/orders` `action:"pack"`
- **DB:** `packedAt = now`, `status → PACKED`. Guard: `readyVerified === true` and `packedAt IS NULL` in the `updateMany` predicate.
- **`BuyerNotification`:** `ORDER_PACKED`.
- **Re-renders:** artisan card actions (Pack disables, Dispatch enables); `BuyerOrders`; buyer bell.

### E6 — Dispatched
- **Trigger:** `PATCH /api/artisan/orders` `action:"dispatch"` `{ courierName?, trackingRef? }`
- **DB:** `dispatchedAt = now`, `courierName`, `trackingRef`, `status → DISPATCHED`. Guard: `packedAt IS NOT NULL` and `dispatchedAt IS NULL`.
- **`BuyerNotification`:** `ORDER_DISPATCHED`, carrying courier and tracking reference when supplied.
- **Re-renders:** artisan card; `BuyerOrders` (courier row and the `DISPATCHED` rung); buyer bell.

### E7 — Buyer purchase
- **Trigger:** `POST /api/payments/verify-payment`, **after** the HMAC check passes.
- **DB:** unchanged from today, plus — when `relatedDemandId` is present — bind the matching `ArtisanOrder.craftItemId` if still null and advance `ACCEPTED → IN_PROGRESS`.
- **Artisan `Notification`:** `PURCHASE` for `item.artisanId`, carrying buyer name, piece, **displayed price** (`salePrice ?? getListingPrice(item)`) and a pack-and-dispatch call to action. Never the ₹1.
- **`BuyerNotification`:** `PURCHASE_CONFIRMED` — only when `relatedDemandId` is present, because the model requires a `demandId`. A plain storefront buy produces the artisan notification and no buyer row; the buyer already has the confirmation screen. This asymmetry is deliberate and must not be papered over by inventing a synthetic demand.
- **Non-fatal:** both writes sit in a `try/catch` after the payment transaction commits, matching the demand fan-out pattern. A notification failure must never turn a verified payment into an error.
- **Re-renders:** artisan bell and `/artisan/orders`; `BuyerOrders`.

### E8 — Buyer marked delivered
- **Trigger:** `POST /api/buyer/orders/delivered`
- **DB:** `Demand.deliveredAt`, `Demand.status → FULFILLED`; per uncredited `ArtisanOrder`: `settledAmount`, `settledAt`, `status → DELIVERED`, guarded by `updateMany({ where: { id, settledAt: null } })`.
- **Artisan `Notification`:** one `ORDER_DELIVERED` per credited order, naming the credited amount as the agreed price.
- **`BuyerNotification`:** `ORDER_DELIVERED`.
- **Re-renders:** `BuyerOrders` (the verify form appears); `/artisan/orders` (the order leaves "current"); both bells.
- **Second click:** short-circuits on `deliveredAt` — zero credits, zero notifications.

---

## 4. Ready-verification design

### 4.1 One comparator, two callers

`src/lib/buyerVerify.ts` is refactored so the Gemini call lives in a single exported function and `verifyBuyerImage()` becomes one of its two callers.

```ts
export interface PhotoComparison {
  similarityScore: number;       // 0–100, clamped, never fabricated
  isMatch: boolean;              // isAuthentic && similarityScore >= MIN_SIMILARITY
  reasoning: string;             // <= 500 chars
  /** Which path produced the number. 'fallback' means Gemini was unreachable. */
  scoredBy: 'gemini' | 'fallback';
}

export async function compareProductPhotos(
  originalImage: string,
  candidateImage: string
): Promise<PhotoComparison>;
```

Everything currently inside `verifyBuyerImage`'s `try` block moves here verbatim: `prepareForVision()` on both frames, the `describeSaving` log line, the exact prompt string, `generateContentWithFallback` with `responseMimeType: 'application/json'` and `thinkingConfig: { thinkingBudget: 0 }`, the JSON parse, the clamp, and the `catch` that returns `similarityScore: 98` / `isMatch: true` / "fallback mode active due to AI quota limits".

The one behavioural change: the fallback path now sets `scoredBy: 'fallback'`, which both callers surface. Today the buyer's UI shows a bare 98% with no indication that the model never ran. The honesty rule the rest of this codebase already follows (`scoredBy: 'text' | 'reference'` on `/api/demand/match`) says which path ran, and this brings verification into line.

`MIN_SIMILARITY = 75`, `MAX_IMAGE_BYTES`, `IMAGE_DATA_URL_RE` and `base64Bytes` stay exported from the same module — three routes import them today and must keep compiling.

`verifyBuyerImage()` keeps its full existing shape (patch resolution, `artisanMatch`, `qrValid`, the health-reward transaction) and gains one behaviour change, described in §9.

### 4.2 What the artisan's check adds

`POST /api/artisan/orders/verify-ready`, guarded by `requireArtisan()`.

Body: `{ orderId, patchId, scannedPatchId?, readyImageBase64 }`.

In order, refusing early:

| Step | Check | Failure |
|---|---|---|
| a | Order exists, `artisanId === auth.artisan.userId`, `status ∈ {ACCEPTED, IN_PROGRESS}` | `404` if unknown, `403` if not theirs, `409` if past READY (unless idempotent — below) |
| b | `readyImageBase64` matches `IMAGE_DATA_URL_RE` and `base64Bytes(...) <= MAX_IMAGE_BYTES` | `400` |
| c | `patchId` resolves to a `CraftItem` **whose `artisanId` is the caller** | `403` — *"That patch belongs to another artisan's piece."* This is the check that makes the whole feature worth having |
| d | If `scannedPatchId` is present, `scannedPatchId === patchId` | `400` — a scanned QR that disagrees with the submitted code is a mismatch, not a typo to forgive |
| e | The resolved item has `images[0]` | `422`, actionable: the original capture is the only thing to compare against |
| f | `compareProductPhotos(item.images[0], readyImageBase64)` | — |

**On pass** (`isMatch === true`), one `$transaction`:

```
artisanOrder.updateMany({
  where: { id, artisanId, readyVerified: false },      // <- the idempotency guard
  data:  { craftItemId, readyVerified: true, readyImageUrl,
           readyScanPatchId: patchId, readySimilarityScore, readyVerifiedAt: now,
           status: 'READY' },
})
buyerNotification.create({ type: 'ORDER_READY', … })    // only when count > 0
```

**On fail:** `200` with `{ success: true, passed: false, similarityScore, reasoning, scoredBy }`. **Nothing is written.** No status change, no `craftItemId`, no notification, **and no artisan health penalty** — `healthAfterGuilty` exists for an admin's GUILTY verdict on a buyer's dispute, and an artisan photographing their own work badly is not fraud. Retry is unlimited.

**Idempotency:** a second call against an already-`readyVerified` order returns `200` with the *stored* `readySimilarityScore`, `readyScanPatchId` and `readyVerifiedAt` plus `{ idempotent: true }`. It does **not** re-run Gemini — this deployment's key is on a free tier at roughly 20 requests/day/model, and a double-tapped button must not burn two of them.

### 4.3 Artisan UI

`src/app/artisan/orders/page.tsx`: the `completingOrder` modal is replaced by a **Ready → Verify** sheet that mounts `QrScanModal`. That component already decodes patch QRs (`parseScannedPatchId` against `window.location.origin`, zxing with a `BarcodeDetector` fallback) *and* captures a downscaled JPEG on one surface — exactly the two inputs this check needs, on one screen, which is what a phone in a workshop can actually do.

Result rendering reuses `BuyerVerifyResult`'s visual language: mint card on pass, red on fail, per-check rows with the score right-aligned. `BuyerVerifyResult` itself is not reused directly (its four rows are the buyer's checks, not these), so a sibling `ReadyVerifyResult` is added next to it with the same `Row` treatment.

Pack and Dispatch then appear as sequential buttons on the card, each disabled until its predecessor's timestamp exists, with `courierName` / `trackingRef` inputs revealed by Dispatch. Every card carries a compact eight-state stepper.

---

## 5. Matching upgrade

`craftMatchScore()` is **kept and exported unchanged** — it is the craft component, it encodes the strong/weak token distinction that stops a Sambalpuri demand alerting the whole silk cluster, and other code may import it. A new function wraps it.

```ts
export interface MatchBreakdown {
  /** 0–100, normalised over the signals the demand actually carries. */
  total: number;
  /** Short human phrases, in weight order. Empty when only craft matched. */
  reasons: string[];
}

export function scoreArtisanForDemand(
  profile: { craftType: string; location: string | null; clusterName: string | null;
             tags: string[]; recentListingCount: number },
  demand: DemandLike
): MatchBreakdown;
```

### Weights

| Signal | Weight | How it scores | Reason phrase |
|---|---|---|---|
| Craft | **50** | `min(1, craftMatchScore(profile.craftType, demand.craftType) / 100)` — dominant, and the only signal always present | `"Your craft: {craftType}"` |
| Material | 15 | token overlap of `demand.material` against `profile.craftType + profile.tags` | `"Works in {material}"` |
| Category | 10 | `demand.category` tokens against `profile.craftType + tags` | `"Category: {category}"` |
| Colour | 10 | `demand.color` tokens against `profile.tags` | `"Has worked in {color}"` |
| Location | 10 | 1.0 on a case-insensitive exact match of `location` or `clusterName`, 0.5 on a substring either way | `"Near {location}"` |
| Capacity | 5 | `min(1, recentListingCount / ceil(quantity / 10))`; full marks when `purchaseType === 'INDIVIDUAL'` | `"Capacity for {quantity} pieces"` |

**Renormalisation, and the rule about absent signals.** A signal the buyer did not fill in is dropped from both the numerator and the denominator — exactly the pattern `textScore()` in `/api/demand/match` already uses. It is never scored as zero, because a demand with no colour specified must not rank a colour-tagged artisan above one who simply has no tags. A signal that *is* present but does not match contributes 0 out of its weight and produces **no reason phrase** — this is the brief's rule that the artisan is never shown an invented number for a signal that was not there.

An artisan scoring 0 on craft is dropped before any other signal is computed, preserving today's `filter(p => p.score > 0)` behaviour: the other five signals must never be able to alert a Dhokra caster to a saree demand.

### Where the reason goes

Appended to `Notification.message` as a second line:

```
{demandAlertMessage(demand)}
Why you: {reasons.join(' · ')}
```

**No new column.** `NotificationsBell` already renders `message` verbatim, the notifications page reads the same rows, and the SMS body is built separately by `buildDemandSms()` and is unaffected. A `matchReason` column would need a second render path on both surfaces for no gain.

`buildDemandSms()` gains **one** optional input, `sizeSpec`, appended only when the resulting body still fits: the function already truncates at 160 characters, and a size that pushes past the budget is better dropped than a price that gets cut off. `category`, `purchaseType` and the flexibility matrix are **not** sent by SMS — they cost characters and change nothing about whether an artisan replies "1".

Unchanged: one notification per artisan per demand, the ≤25 recipient cap, and every SMS failure swallowed with a `console.warn`.

---

## 6. Track unification

`GET /api/demand/track?demandId=` is rewritten to read `ArtisanOrder` **first**.

```
1. Load the Demand.
2. Load its ArtisanOrders, with { logs, craftItem, artisan } included, in ONE query.
3. If any order exists  -> build the payload from the orders (the primary path).
4. If none exist        -> fall back to the notification-derived view, kept
                           verbatim and clearly labelled as the fallback.
```

**Primary path.** Each `ArtisanOrder` becomes one `TrackedItem`:

| `TrackedItem` field | Source |
|---|---|
| `id` | `order.id` |
| `craftType` | `order.craftItem?.craftType ?? demand.craftType` |
| `patchId` | **always `null`** — the public tracker never exposes a patch id, exactly as today |
| `image` | `order.readyImageUrl ?? order.craftItem?.images[0] ?? demand.referenceImageUrls[0] ?? null` |
| `artisanName` | `order.artisan.name` |
| `stage` | `resolveDemandStage(order, order.craftItem)` |
| `stageAt` | the newest of `dispatchedAt`, `packedAt`, `readyVerifiedAt`, `lastLogAt`, `createdAt` |
| `price` | `order.negotiatedPrice ?? demand.targetPriceMax ?? demand.targetPriceMin` — the agreed price, never `paidAmountPaise` |

`fulfilled` becomes the count of orders whose resolved stage is `DELIVERED` — the *same* definition `/api/buyer/orders` applies to its own rows. That is what makes the two agree: both now count committed orders reaching the end of the ladder, rather than one counting keyword-matched inventory and the other counting paid pieces.

**Fallback path** (no `ArtisanOrder` on this demand) keeps today's `Notification.relatedDemandId` → keyword `CraftItem` query untouched, and the response gains `source: 'orders' | 'notifications'` so the UI can say which view it is showing instead of silently presenting a keyword guess as a commitment.

The response stays a superset of `TrackPayload`, so `OrderTimeline` renders it with no change. New fields: `source`, `readyVerified`, `readySimilarityScore`, `packedAt`, `dispatchedAt`, `courierName`, `trackingRef`, `dailyUpdates`.

**No N+1.** Orders, their logs and their bound `CraftItem`s come back in one `findMany` with `include`. The fallback path keeps its single batched `craftItem.findMany({ artisanId: { in: [...] } })`.

---

## 7. File-by-file work order

Dependency order. The app builds after each block.

### Block 0 — schema
| File | Why |
|---|---|
| `prisma/schema.prisma` | The new `Demand` / `ArtisanOrder` fields, the `BuyerNotification` model, the `CraftItem.artisanOrders` back-relation, and the new indexes. Everything downstream is typed off this. |

### Block 1 — libraries
| File | Why |
|---|---|
| `src/lib/orderStage.ts` | `demandOrderStage()`, `resolveDemandStage()`, `ORDER_STATUSES` / `DEMAND_STATUSES` with `advanceOrderStatus()` / `advanceDemandStatus()`, and the `stage_ready` / `stage_packed` sub-label keys. `resolveStage()` untouched. |
| `src/lib/buyerVerify.ts` | Extract `compareProductPhotos()`; add `scoredBy` to the result; add the bound-`craftItemId` rule to `artisanMatch`. |
| `src/lib/buyerNotify.ts` **(new)** | `createBuyerNotification()` — one writer for all eight types, with the per-order-per-day `DAILY_UPDATE` throttle and a swallow-all `catch`, so no caller can make a notification failure fatal. |
| `src/lib/notifications.ts` | `scoreArtisanForDemand()`, the multi-signal fan-out, the reason line, the widened profile `select`. |
| `src/lib/sms.ts` | `buildDemandSms()` takes an optional `sizeSpec`, appended only inside the 160-character budget. |

### Block 2 — buyer-facing APIs
| File | Why |
|---|---|
| `src/app/api/demand/route.ts` | Accept, trim, bound and persist every new field; enum guards; the ≤4 × 2 MB image array; reject a past `requiredBy`; mirror `[0]` to the legacy column; GET returns the new fields. |
| `src/app/api/demand/recommend/route.ts` | Accept `category`, `sizeSpec`, `purchaseType` so the live panel reasons about what the buyer actually typed. |
| `src/app/api/buyer/notifications/route.ts` **(new)** | `GET ?buyer=` (capped, paginated, case-insensitive) and `POST` to mark read — scoped by `buyerName` so one buyer can never read or clear another's. |

### Block 3 — artisan lifecycle APIs
| File | Why |
|---|---|
| `src/app/api/artisan/orders/verify-ready/route.ts` **(new)** | The six-step check of §4.2. |
| `src/app/api/artisan/orders/route.ts` | `pack` / `dispatch` PATCH actions; `complete` gated on `readyVerified`; GET returns the new fields, `lastLogAt`, `updateOverdue` and `completedImageUrl` (F13). |
| `src/app/api/artisan/orders/log/route.ts` | Write `lastLogAt`; advance `Demand.status` to `IN_PRODUCTION`; throttled `DAILY_UPDATE`. |
| `src/app/api/payments/verify-payment/route.ts` | The `PURCHASE` artisan notification, the `PURCHASE_CONFIRMED` buyer notification, and the `ArtisanOrder` bind — all best-effort after the transaction commits. |
| `src/app/api/demand/track/route.ts` | The rewrite of §6. |
| `src/app/api/buyer/orders/route.ts` | Return the ready / packed / dispatched / courier / `lastLogAt` / `craftItemId` chain. |
| `src/app/api/buyer/orders/delivered/route.ts` | Widen the status predicate to the new vocabulary; write `DELIVERED`; notify both sides. |
| `src/app/api/buyer/orders/verify/route.ts` | Pass the bound `craftItemId` through to `verifyBuyerImage`. |
| `src/app/api/buyer/verify-item/route.ts` | Same, for the scan-anywhere path. |

### Block 4 — UI
| File | Why |
|---|---|
| `src/components/PostDemandModal.tsx` | The five-section rebuild, multi-image upload, field-level validation. |
| `src/components/DemandRecommendation.tsx` | Accept and forward `category`, `sizeSpec`, `purchaseType`. |
| `src/components/ui/DemandRequestCard.tsx` | Render the new structured fields and the flexibility chips — this is what the artisan reads *before* accepting, so it is where the richer capture earns its keep. |
| `src/components/ReadyVerifyResult.tsx` **(new)** | Pass/fail panel for the artisan's check, in `BuyerVerifyResult`'s visual language. |
| `src/components/BuyerNotificationsBell.tsx` **(new)** | Buyer bell and feed, styled from `NotificationsBell`, reading the buyer endpoint, deep-linking to the order card. |
| `src/app/artisan/orders/page.tsx` | Ready sheet (reusing `QrScanModal`), Pack/Dispatch actions, the compact stepper, the overdue nudge, the `?tab=demands&demandId=` deep link, and the widened terminal-status filter. |
| `src/components/BuyerOrders.tsx` | "Last update — N days ago", the honest empty state, the full log timeline, and the ready/packed/dispatched chain. |
| `src/app/buyer/page.tsx` | The new fields on each board card, the buyer bell, the per-demand status pill, and the F11 fix. |
| `src/app/artisan/market/page.tsx` | `buyers` tab becomes a read-only preview deep-linking to `/artisan/orders?tab=demands&demandId=`. |

### Block 5 — strings and docs
| File | Why |
|---|---|
| `src/lib/i18n/en.ts` · `hi.ts` · `or.ts` · `te.ts` | Every new key in all four, plus the 61 pre-existing gaps (F12). |
| `ARCHITECTURE.md` · `docs/CONTRACT.md` · `docs/KARIGARI_FLOWCHARTS.md` · `README.md` | PROMPT 3, §G. |

---

## 8. Risk list

### R1 — Backward compatibility for pre-V9 rows
- Every new column is nullable or defaulted. Audit: `category`, `productType`, `sizeSpec`, `customizationDetails`, `requiredBy`, `additionalRequirements`, `craftItemId`, `readyImageUrl`, `readyScanPatchId`, `readySimilarityScore`, `readyVerifiedAt`, `packedAt`, `dispatchedAt`, `courierName`, `trackingRef`, `lastLogAt` are all `?`. `customizationRequired` and `readyVerified` default `false`. `deliveryMode`, `purchaseType` and the five flex fields default to the **stricter** reading, so a legacy demand is never presented to an artisan as more permissive than the buyer actually was. `referenceImageUrls` defaults to `[]`.
- Legacy `ArtisanOrder` rows carry `status: 'COMPLETED'` written by the *old* delivered route. Under the new ladder `COMPLETED` outranks `DELIVERED`, so `advanceOrderStatus` refuses to move them — correct, they are closed.
- **The trap:** `POST /api/buyer/orders/delivered` filters `status: { in: ['ACCEPTED','IN_PROGRESS','COMPLETED'] }`. Left as-is, a `READY` / `PACKED` / `DISPATCHED` order is silently skipped and **never credited**. This predicate must be widened in the same commit as the status vocabulary.
- Every `.map` / `.length` / `[0]` on `referenceImageUrls`, `dailyUpdates` and `tickets` must be `?? []`-guarded.

### R2 — Idempotency
| Path | Guard |
|---|---|
| accept | existing `findFirst({ artisanId, demandId })` → `{ idempotent: true }`, and **no second `BuyerNotification`** |
| verify-ready | `updateMany({ where: { readyVerified: false } })`; a repeat returns the stored result and does **not** re-call Gemini |
| pack | `updateMany({ where: { packedAt: null, readyVerified: true } })` |
| dispatch | `updateMany({ where: { dispatchedAt: null, packedAt: { not: null } } })` |
| complete | `updateMany({ where: { readyVerified: true, status: { in: ['DISPATCHED','DELIVERED'] } } })` |
| mark delivered | `deliveredAt` short-circuit plus the per-order `updateMany({ where: { settledAt: null } })` already in place today |
| add log | not idempotent by design — two updates in a day are two real updates. Only the buyer's ping is throttled. |
| verify-payment | the existing `paidAt && razorpayPaymentId === paymentId` short-circuit, which must also skip the new notifications |

### R3 — The ₹1 demo-charge invariant
Displayed value is always `salePrice ?? getListingPrice(item)` for a `CraftItem`, and `negotiatedPrice ?? targetPriceMax ?? targetPriceMin` for an `ArtisanOrder`. `paidAmountPaise` is `DEMO_CHARGE_PAISE` and appears only where the existing code already labels it as the amount actually charged (`chargedPaise` + `order_charged_note`). **The new `PURCHASE` and `PURCHASE_CONFIRMED` notification bodies are a fresh place this could leak** — they must quote the displayed price.

### R4 — Honesty rules
- A `SIMULATED` payout is never described as paid. `settledAmount` on an `ArtisanOrder` is a recorded credit at the agreed price, not a bank transfer, and the existing `artisan_paid_note` copy is what the new notification body must echo — not upgrade.
- No AI score is fabricated. When `compareProductPhotos` falls through, both callers surface `scoredBy: 'fallback'` and the UI says the model was unreachable. This is a **behaviour change from today**, where the buyer sees a bare 98%.
- Match confidence keeps `scoredBy: 'text' | 'reference'` on the buyer's match panel, and `DemandRequestCard`'s existing comment about not claiming a method stays true.

### R5 — F11, the fake advance payment
`src/app/buyer/page.tsx`'s "Accept quote" / "Pay advance ₹X" flow moves nothing but React state and then renders `advance_paid_confirmation`. Under an honesty rule that forbids calling a *simulated* payout paid, calling a **non-existent** one paid is worse. V9 replaces those two buttons with a link to the real purchase path (`/marketplace/product/{id}?demand={demandId}`), which is what actually creates a Razorpay order. The `quoteState` `'accepted' | 'paid'` machine and the `ADVANCE_RATE` summary block are deleted rather than rewired — the 40% advance is a `CraftItem` escrow concept and a demand order has no escrow row, so there is nothing truthful for that panel to show.

### R6 — Gemini quota
This deployment's key is on a free tier at roughly 20 requests/day/model. V9 adds a *second* vision consumer (the artisan's ready-check) to a system already spending that quota on demand matching and buyer verification. Mitigations, all of which must be in the implementation: the ready-check runs once per order and never re-runs on an already-verified order; `prepareForVision` downscaling stays; the fallback path stays non-fatal; and the UI states which path ran, so a quota-exhausted demo degrades visibly rather than silently.

### R7 — Payload size
Four 2 MB reference images is an 8 MB `POST /api/demand` body of base64, over a phone connection. The client validates type and size **before** the `FileReader` runs, downscales through the existing `prepareImage()` helper, and the server re-validates each element independently. A rejected image still must not fail the whole demand — that is today's behaviour in `referenceImage()`, and it is preserved for the array, with rejections reported back in the response.

### R8 — i18n
`en.ts` is already 61 keys ahead of the other three (F12). Adding roughly 70 V9 keys to English alone would push the gap past 130 and break the "no key defined in one dictionary only" rule on arrival. PROMPT 2 §11 therefore covers both the new keys and the existing 61, and PROMPT 3's throwaway diff script is the gate.

### R9 — Case-insensitive buyer identity
Everything keyed on `buyerName` is a `mode: 'insensitive'` string compare with no functional index behind it. Two buyers who both type "Anjali" share a notification feed. This is an existing property of the demand board, order history, reviews and tickets; V9 inherits it rather than fixing it, because fixing it means giving buyers accounts, which is a different piece of work. The new endpoint must not make it *worse* — no `contains`, no prefix matching, exact-equals-insensitive only.

### R10a — What the audit actually caught

The risks below were the ones predicted. These are the ones only the audit found,
recorded here because a plan that never gets corrected is a plan nobody trusts:

| # | Found | Severity | Resolution |
|---|---|---|---|
| A1 | The `complete` PATCH action lost its only UI caller when the old modal was replaced, leaving `COMPLETED` unreachable and `completedImageUrl` never written | High | Restored as a photo-gated action on dispatched orders |
| A2 | `border-red-300` / `border-red-400` / `text-amber-700` are **not** in `globals.css`. Tailwind falls back to its own stock palette for undefined shades — `red-300` painted a bright `lab()` red, and `red-400` was not emitted at all so the invalid-field border resolved to `currentColor` and rendered near-black | High | Replaced with `red-500` / `red-600` / `amber-800`, all real tokens |
| A3 | 48 tap targets under 44px in the rebuilt form (chips 36px, radios 40px, inputs 42px, close button 36px) | Medium | All raised; verified 0 under 44px at 375px |
| A4 | Three new indexes had no query behind them | Low | Removed — see the note in §1.2 |
| A5 | Eight i18n keys orphaned by the F11 deletion | Low | Pruned from all four dictionaries |
| A6 | `docs/CONTRACT.md` had an unclosed ```` ```mermaid ```` fence from before V9, which would have rendered the entire appended V9 section as code | Low | Fence closed |

**A near-miss worth recording.** The first attempt at pruning the orphaned keys
used a non-greedy regex with a lookahead. When the entry following a target did
not match the lookahead, the match ran to the end of the object and deleted ~590
keys from three dictionaries. It was caught immediately because the key-parity
diff is re-run after every mutation, and the files were restored from `git show`
and rebuilt. The replacement walks lines and tracks entry boundaries, and it
refuses to write a file when the count removed does not match the count intended.

### R10 — Two writers racing the same demand
`POST /api/payments/verify-payment` and `POST /api/buyer/orders/delivered` can both advance `Demand.status`. Both go through `advanceDemandStatus`, and both read-then-write inside their existing transactions. A concurrent pair can still interleave so the lower rank wins; the mitigation is that both re-read `status` inside the transaction and compare ranks, which is what today's `if (demand.status !== 'FULFILLED' && demand.status !== next)` guard already approximates.

---

## Constraints honoured

- **No new npm dependencies.** Everything above uses `@prisma/client`, `@google/genai`, `@zxing/browser`, `lucide-react`, `sharp` and `twilio`, all already in `package.json`.
- **Existing design tokens only.** `--color-primary`, `--color-maroon`, `--color-rust`, `--color-mint`, `--color-sage`, `--color-pill` and the `--color-gray-*` ramp. No new colour, radius, shadow or font.
- **Every user-visible string is an i18n key present in all four dictionaries.**
- **No `middleware.ts`.** Per-route `requireArtisan()` stays the pattern; buyer routes stay public and identity-checked by case-insensitive `buyerName`.
- **`export const dynamic = 'force-dynamic'`** on every new route handler.
