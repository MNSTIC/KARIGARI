# MASTER PROMPT — 6 ADVANCED FEATURES (AI Recommendations, Ratings, Clusters, Orders, Autonomous Assistant, Smart Capture)

> Paste this whole file into Claude Code as your task. It is self-contained and maps every change to exact files/lines in the repo. Work top to bottom; verify after each item.

---

## 0. ROLE & MISSION

You are a **principal full-stack engineer** on **KARIGARI** (SIH 2026, MoSJE PS 26090).

**Non-negotiable quality bar:** every feature must be dynamic (real DB data, no hard-coded fake numbers), working end-to-end, and smoothly rendered. This is demo-day software judged live.

**Scope:** Work only inside the app root. Do not refactor unrelated code, do not add extra dependencies unless explicitly listed.

---

## 1. WHERE THE CODE IS (CRITICAL PATH CONVENTIONS)

### 1.1 Nested Folder Warning
The app root is `KARIGARI-main/KARIGARI/` (package.json = `karigari-app`).

```bash
cd KARIGARI-main/KARIGARI && git status && git log --oneline -5 && npm install
```

### 1.2 Tech Stack
| Concern | Implementation |
|---------|---------------|
| Framework | **Next.js 16.3.1** App Router, **React 19.2.8**, TypeScript |
| Database | **Prisma 7.9.1** → PostgreSQL via `@prisma/adapter-pg` |
| AI | **Google Gemini** (`@google/genai`) via `generateContentWithFallback` in `src/lib/gemini.ts` |
| Auth | JWT in httpOnly cookie `auth-token`, roles: `ADMIN \| ARTISAN` only (no buyer role) |
| Styling | **Tailwind CSS v4** with `@theme` in `src/app/globals.css` |
| i18n | `useLanguage()` hook → `src/lib/i18n/{en,hi,or,te}.ts` — all 4 languages for every new string |
| Images | Data URLs (base64) stored in PostgreSQL `String[]` columns — **no S3** |
| Pricing | `src/lib/pricing.ts` — use `formatRupees()`, `getListingPrice()`, `estimateCraftValuation()` |
| AI Fallback | If Gemini unconfigured/errors → always fallback to rule-based heuristics. Never crash. |

### 1.3 Next.js 16 Breaking Changes (MUST follow)
- `cookies()` is async: always `await cookies()`
- `params` is a Promise in server components: `const { id } = await params`
- **Never** use `useSearchParams()` in client pages — read `window.location.search` inside a deferred `useEffect` instead (no Suspense boundary needed)
- Import Prisma singleton: `import { prisma } from '@/lib/prisma'` — never `new PrismaClient()`
- Restart dev server after `prisma generate`

### 1.4 Design Tokens (use these, never raw hex)
- Primary: `var(--color-primary)` (#24332C), `var(--color-primary-dark)` (#1A2721), `var(--color-primary-light)` (#3D5145)
- Background: `var(--color-background)` (#FCF8F7), `var(--color-mint)` (#DCEBE0), `var(--color-sage)` (#A9BFB0)
- Cards: `rounded-2xl shadow-card border border-gray-100`, headings `font-serif`, body `font-sans`
- Interactions: `kg-press` and `kg-rail` classes

### 1.5 Audit Logging
Every `CraftItem` status change MUST call `logCraftItemEvent` from `@/lib/auditLogger`.

### 1.6 i18n Rule
Every user-facing string MUST be registered in ALL 4 language files: `en.ts`, `hi.ts`, `or.ts`, `te.ts`. Use the `t()` function from `useLanguage()` hook. For API-side responses use English.

---

## 2. GROUND TRUTH — SCHEMA CHANGES FIRST

Before touching any UI or route, apply **ALL** Prisma schema changes below. Then:

```bash
npx prisma db push && npx prisma generate
```

**Restart the dev server** after running `prisma generate` (cached Prisma client throws `Unknown argument` otherwise).

### 2.1 New Models to Add in `prisma/schema.prisma`

```prisma
// ── FEATURE 2: Customer Reviews & Ratings ──────────────────────────
model Review {
  id          String   @id @default(uuid())
  craftItemId String
  craftItem   CraftItem @relation(fields: [craftItemId], references: [id])
  buyerName   String            // from CraftItem.buyerName at purchase time
  buyerContact String?          // from CraftItem.buyerContact
  rating      Int               // 1-5 stars
  comment     String?           // optional text review
  images      String[]          // optional attached images (data URLs, same as everywhere else)
  createdAt   DateTime @default(now())

  @@index([craftItemId])
  @@index([createdAt])
}

// ── FEATURE 3: Artisan Cluster Resource Sharing ────────────────────
model ResourceRequest {
  id            String   @id @default(uuid())
  requesterId   String           // userId of the artisan who needs the resource
  requester     User     @relation("ResourceRequester", fields: [requesterId], references: [id])
  resourceName  String           // what material/resource they need
  description   String?          // details about the request
  quantity      String?          // how much they need
  status        String   @default("OPEN") // OPEN, ACCEPTED, FULFILLED, CANCELLED
  acceptedById  String?          // userId of artisan who accepted
  acceptedBy    User?    @relation("ResourceAccepter", fields: [acceptedById], references: [id])
  acceptedAt    DateTime?
  clusterName   String           // cluster this request belongs to
  createdAt     DateTime @default(now())

  @@index([clusterName, status])
  @@index([requesterId])
  @@index([createdAt])
}

// ── FEATURE 4: Artisan Orders / Demand Acceptance ──────────────────
model ArtisanOrder {
  id              String     @id @default(uuid())
  artisanId       String
  artisan         User       @relation(fields: [artisanId], references: [id])
  demandId        String
  demand          Demand     @relation(fields: [demandId], references: [id])
  status          String     @default("ACCEPTED") // ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED
  negotiatedPrice Float?     // if artisan negotiated a different price
  deadline        DateTime?
  logs            OrderLog[]
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@index([artisanId])
  @@index([demandId])
  @@index([status])
}

model OrderLog {
  id              String       @id @default(uuid())
  artisanOrderId  String
  artisanOrder    ArtisanOrder @relation(fields: [artisanOrderId], references: [id])
  note            String?      // text update from artisan
  imageUrl        String?      // optional progress photo (data URL)
  createdAt       DateTime     @default(now())

  @@index([artisanOrderId])
  @@index([createdAt])
}
```

### 2.2 Modify Existing Models

Add these fields/relations to **existing** models:

#### In model `CraftItem` — add this relation:
```prisma
  reviews       Review[]
```

#### In model `ArtisanProfile` — add this field:
```prisma
  shgGroupLink  String?           // "Link to SHG group" from registration
```

#### In model `User` — add these relations:
```prisma
  resourceRequestsMade     ResourceRequest[] @relation("ResourceRequester")
  resourceRequestsAccepted ResourceRequest[] @relation("ResourceAccepter")
  artisanOrders            ArtisanOrder[]
```

#### In model `Demand` — add this relation:
```prisma
  artisanOrders  ArtisanOrder[]
```

### 2.3 Data Model Realities
- There is **no Order table** in the existing schema — a sale IS a `CraftItem` that moves through statuses + escrow stages. The new `ArtisanOrder` model is specifically for demand-acceptance tracking (Feature 4), distinct from the existing payment/escrow flow.
- Buyers have **no user accounts** — they are identified by free-text `buyerName` + `buyerContact` on `CraftItem`. Reviews are gated by matching `buyerName` against purchased items.
- `clusterName` already exists on `ArtisanProfile` — Feature 3 uses it to group artisans.

---

## 3. FEATURE 1 — AI DEMAND RECOMMENDATION SYSTEM

### 3.1 What It Does
A real-time AI recommendation panel **inside** the PostDemandModal form. As the buyer fills mandatory fields (craftType, quantity, price range, material), the AI evaluates:
- Whether the price the buyer set is realistic for the product + material specified
- If too low → recommends increasing price OR suggests alternative materials
- If everything is reasonable → shows a green check: "Your demand looks good and can be fulfilled"
- **Don't overdo it** — if inputs are correct, just confirm. No unnecessary warnings.

### 3.2 Files to Create

#### [NEW] `src/components/DemandRecommendation.tsx`
A client component rendered inside `PostDemandModal.tsx` that:
- Receives current form state as props: `{ craftType, quantity, targetPriceMin, targetPriceMax, material, color, description }`
- Has a `useEffect` with a **1-second debounce** that fires only when all mandatory fields (craftType + quantity + at least one price) are filled
- Calls `POST /api/demand/recommend` with the form data
- Shows a compact result card below the form
- States: `idle` → `analyzing` → `result`
- Fallback: If Gemini unavailable, use `estimateCraftValuation()` from `src/lib/pricing.ts`

**UI design:**
- Card with `bg-[var(--color-mint)]` background, `border border-[var(--color-sage)]/50`, `rounded-xl p-4`
- Icons: `Sparkles` (analyzing), `CheckCircle2` (good), `AlertTriangle` (price concern) from `lucide-react`
- Text: 2-3 sentences max, concise

#### [NEW] `src/app/api/demand/recommend/route.ts`
Public API (no auth — buyers have no accounts). POST with:
```typescript
{ craftType: string; quantity: number; targetPriceMin?: number; targetPriceMax?: number;
  material?: string; color?: string; description?: string; }
```

**Logic:**
1. Estimate labor days from craft/material: silk → 8-15d, cotton → 3-7d, wool → 5-10d, default → 5d
2. Estimate raw material cost: silk → ₹800-2000, cotton → ₹200-500, wool → ₹400-800, default → ₹300
3. Call `estimateCraftValuation(craftType, estimatedLaborDays, estimatedRawCost)` from `src/lib/pricing.ts`
4. Compare `targetPriceMax` against `fairWageFloor`:
   - If `targetPriceMax < fairWageFloor * 0.8` → status `"low_price"`
   - Else → status `"good"`
5. If `GEMINI_CONFIGURED`, optionally enhance with a Gemini call for material-specific insight
6. **Graceful degradation**: If Gemini fails, return the rule-based result. Never error the request.

**Response shape:**
```typescript
{ success: true; status: "good" | "low_price" | "suggestion";
  message: string; estimatedFairPrice: number; suggestedMaterials?: string[]; }
```

### 3.3 Files to Modify

#### [MODIFY] `src/components/PostDemandModal.tsx`
**File:** `src/components/PostDemandModal.tsx` (453 lines)

- Import and render `<DemandRecommendation />` after the description textarea (~line 362) and before the reference image section (~line 364)
- Pass form state as props:
```tsx
<DemandRecommendation
  craftType={form.craftType}
  quantity={Number(form.quantity) || 0}
  targetPriceMin={Number(form.targetPriceMin) || undefined}
  targetPriceMax={Number(form.targetPriceMax) || undefined}
  material={form.material}
  color={form.color}
  description={form.description}
/>
```

### 3.4 i18n Keys (add to all 4 files)
```
"demand_ai_analyzing": "Analyzing your demand..."
"demand_ai_looks_good": "Your demand looks good and should attract artisans."
"demand_ai_price_low": "The price seems low for this craft. Consider increasing to around ₹{price} for fair artisan wages."
"demand_ai_suggestion": "Suggestion"
"demand_ai_alternative_materials": "Alternative materials in your budget:"
"demand_ai_recommendation": "AI Recommendation"
"demand_ai_estimated_fair_price": "Estimated fair price"
```

---

## 4. FEATURE 2 — DYNAMIC CUSTOMER RATINGS & REVIEWS

### 4.1 What It Does
- Star ratings and text reviews on every marketplace product
- Only buyers who **actually purchased** (matched by `buyerName` on `CraftItem` with status `SOLD_FINAL` or `PAYOUT_COMPLETED`) can leave a review
- Buyers can attach up to 3 images per review
- Average rating appears on `ProductCard` in the marketplace grid and on the product detail page
- Artisan average rating is computed from all their products' reviews

### 4.2 Files to Create

#### [NEW] `src/app/api/reviews/route.ts`
**GET** `?craftItemId=<id>` — fetch reviews + aggregate:
```typescript
const reviews = await prisma.review.findMany({
  where: { craftItemId },
  orderBy: { createdAt: 'desc' },
  take: 50,
});
const stats = await prisma.review.aggregate({
  where: { craftItemId },
  _avg: { rating: true },
  _count: { id: true },
});
return { success: true, reviews, avgRating: stats._avg.rating, totalReviews: stats._count.id };
```

**POST** — submit a review (validates purchase):
```typescript
// 1. Validate buyer purchased this item
const purchased = await prisma.craftItem.findFirst({
  where: { id: craftItemId, buyerName: { equals: buyerName, mode: 'insensitive' },
           status: { in: ['SOLD_FINAL', 'PAYOUT_COMPLETED'] } },
});
if (!purchased) → 403 "Only buyers who purchased this item can leave a review"
// 2. Check no duplicate review
const existing = await prisma.review.findFirst({
  where: { craftItemId, buyerName: { equals: buyerName, mode: 'insensitive' } },
});
if (existing) → 400 "You have already reviewed this item"
// 3. Validate: rating 1-5, images <= 3, each image <= 2MB data URL
// 4. Create review
```

#### [NEW] `src/app/api/reviews/artisan/route.ts`
**GET** `?artisanId=<id>` — artisan's aggregate rating:
```typescript
const stats = await prisma.review.aggregate({
  where: { craftItem: { artisanId } },
  _avg: { rating: true },
  _count: { id: true },
});
```

#### [NEW] `src/components/ReviewSection.tsx`
Client component for the product detail page:
- Star rating display with average + count
- Review list: buyer name, date, rating stars, comment text, optional image gallery
- "Write a Review" form gated by: does `buyerName` (from `readBuyerName()`) match a purchase?
- Star rating selector (clickable) + comment textarea + image upload (max 3, max 2MB each)

#### [NEW] `src/components/ui/StarRating.tsx`
Reusable star display/selector:
```tsx
export function StarRating({ rating, size = 14, interactive = false, onChange }: {
  rating: number; size?: number; interactive?: boolean;
  onChange?: (rating: number) => void;
})
```
Uses lucide `Star` icon. Filled = `text-yellow-500 fill-yellow-500`, empty = `text-gray-300`.

### 4.3 Files to Modify

#### [MODIFY] `src/app/marketplace/product/[id]/ProductClient.tsx`
**File:** `src/app/marketplace/product/[id]/ProductClient.tsx` (559 lines)

- Import `ReviewSection`, render it after the product detail body
- Pass `craftItemId={id}`, `buyerName` from `readBuyerName()` in `@/lib/buyerIdentity`

#### [MODIFY] `src/components/ui/ProductCard.tsx`
- Accept `avgRating?: number | null` and `reviewCount?: number` props
- Display `<StarRating rating={avgRating} size={12} />` + count below the price

#### [MODIFY] `src/app/api/items/market/route.ts`
**File:** `src/app/api/items/market/route.ts` (139 lines)

After fetching items, aggregate review stats:
```typescript
const reviewStats = await prisma.review.groupBy({
  by: ['craftItemId'],
  _avg: { rating: true },
  _count: { id: true },
});
const ratingMap = new Map(reviewStats.map(r => [r.craftItemId, { avg: r._avg.rating, count: r._count.id }]));
// Add avgRating and reviewCount to each formatted item
```

### 4.4 i18n Keys
```
"reviews_title": "Customer Reviews"
"reviews_write": "Write a Review"
"reviews_submit": "Submit Review"
"reviews_rating": "Rating"
"reviews_comment": "Your Review"
"reviews_images": "Attach Photos"
"reviews_no_reviews": "No reviews yet. Be the first to review!"
"reviews_purchase_required": "Only buyers who purchased this item can leave a review."
"reviews_already_reviewed": "You have already reviewed this item."
"reviews_submitted": "Review submitted successfully!"
"reviews_avg_rating": "Average Rating"
"reviews_count": "{count} reviews"
"reviews_verified_buyer": "Verified Buyer"
```

---

## 5. FEATURE 3 — ARTISAN CLUSTER PAGE

### 5.1 What It Does
New "Cluster" tab in artisan sidebar showing:
- **If artisan has `shgGroupLink`**: shows other artisans with the SAME `shgGroupLink`
- **If no `shgGroupLink`**: auto-clusters artisans from the same `location` who also lack an SHG link
- **Resource Sharing**: artisans post requests for needed materials; cluster members can accept

### 5.2 Registration Change

#### [MODIFY] `src/app/register/page.tsx`
**File:** `src/app/register/page.tsx` (360 lines)

In `formData` state (line 26-37), add `shgGroupLink: ""`.
Add an input field after the clusterName or location area:
```tsx
<div>
  <label className={label} htmlFor="shg-link">
    {t("register_shg_link")} <span className="text-gray-400 normal-case">(optional)</span>
  </label>
  <input id="shg-link" name="shgGroupLink" className={field}
    value={formData.shgGroupLink} onChange={handleChange}
    placeholder="https://shg.example.com/group/..." />
</div>
```

#### [MODIFY] `src/app/api/auth/register/route.ts`
Accept `shgGroupLink` from the body and pass it to `prisma.artisanProfile.create({ data: { ..., shgGroupLink } })`.

### 5.3 Files to Create

#### [NEW] `src/app/artisan/cluster/page.tsx`
Layout:
1. **Cluster Members** grid: cards with avatar, name, craft type, location, experience
2. **Resource Sharing** section:
   - "I Need a Resource" button → inline form (resourceName, quantity, description)
   - List of open requests from cluster: each shows requester name, resource, quantity, "I Can Help" button

#### [NEW] `src/app/artisan/cluster/loading.tsx`
Standard skeleton matching `src/app/artisan/dashboard/loading.tsx` pattern.

#### [NEW] `src/app/api/artisan/cluster-members/route.ts`
Auth-protected (ARTISAN). Returns cluster members + resource requests:
```typescript
const profile = await prisma.artisanProfile.findUnique({ where: { userId } });
// Determine cluster
const clusterWhere = profile.shgGroupLink
  ? { shgGroupLink: profile.shgGroupLink }
  : { shgGroupLink: null, location: profile.location };
// Find members (exclude self)
const members = await prisma.artisanProfile.findMany({
  where: { ...clusterWhere, userId: { not: userId } },
  include: { user: { select: { id: true, name: true } } },
});
// Resource requests
const clusterKey = profile.shgGroupLink || `auto:${profile.location}`;
const requests = await prisma.resourceRequest.findMany({
  where: { clusterName: clusterKey, status: { in: ['OPEN', 'ACCEPTED'] } },
  include: { requester: { select: { name: true } }, acceptedBy: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
});
```

#### [NEW] `src/app/api/artisan/resource-request/route.ts`
Auth-protected. Handles POST (create), PATCH (accept), PUT (mark fulfilled).

### 5.4 Sidebar Navigation

#### [MODIFY] `src/components/ui/AppShell.tsx`
Add two new navigation items to the sidebar:
```typescript
{ href: "/artisan/cluster", icon: Users, label: t("nav_cluster") },
{ href: "/artisan/orders", icon: ClipboardList, label: t("nav_orders") },
```
Import `Users` and `ClipboardList` from `lucide-react`.

### 5.5 i18n Keys
```
"nav_cluster": "My Cluster"
"nav_orders": "Orders"
"register_shg_link": "Link to SHG Group"
"cluster_title": "My Cluster"
"cluster_shg_group": "SHG Group Members"
"cluster_auto_group": "Artisans Near You"
"cluster_no_members": "No other artisans found in your cluster yet."
"cluster_resource_sharing": "Resource Sharing"
"cluster_need_resource": "I Need a Resource"
"cluster_resource_name": "Resource Name"
"cluster_resource_qty": "Quantity"
"cluster_resource_desc": "Description"
"cluster_post_request": "Post Request"
"cluster_i_can_help": "I Can Help"
"cluster_request_accepted": "Request Accepted"
"cluster_no_requests": "No resource requests in your cluster."
"cluster_mark_fulfilled": "Mark as Fulfilled"
```

---

## 6. FEATURE 4 — ARTISAN ORDERS PAGE

### 6.1 What It Does
New "Orders" page with:
- **Summary bar** at top: total demands accepted, total earned, current artisan rating
- **Two tabs** via `SegmentedToggle`: "Current Orders" | "Raised Demands"

**Current Orders tab:**
- Shows `ArtisanOrder` records where status is not `COMPLETED`/`CANCELLED`
- Each card: demand details, deadline countdown, description, images
- Artisan adds daily logs: text note or progress photo
- Progress log timeline below each order

**Raised Demands tab:**
- Shows `Demand` records matching the artisan's craft type and domain
- Excludes demands already accepted by this artisan
- Each demand: buyer info, quantity, target price, "Accept" and "Negotiate" buttons
- Accept → creates `ArtisanOrder`; Negotiate → shows price input before accepting

### 6.2 Files to Create

#### [NEW] `src/app/artisan/orders/page.tsx`
Structure:
```tsx
// Summary: 3 StatTile cards
// SegmentedToggle with "current" and "demands" tabs
// Tab content: CurrentOrdersList or RaisedDemandsList
```
Each current order card has:
- Craft type, quantity, description from the linked Demand
- Deadline with days-left countdown
- "Add Daily Update" button → inline form (note text + optional photo)
- Timeline of existing logs below

Each raised demand card has:
- Buyer name, craft type, quantity, price range, description, reference image
- "Accept" button (at the listed price)
- "Negotiate" button → reveals price input + "Send Offer" button

#### [NEW] `src/app/artisan/orders/loading.tsx`

#### [NEW] `src/app/api/artisan/orders/route.ts`
Auth-protected (ARTISAN). **GET** returns:
```typescript
{
  orders: ArtisanOrder[] (with demand and logs),
  stats: { totalAccepted, totalEarned, avgRating },
  matchingDemands: Demand[] (filtered by artisan's craftType, excluding already-accepted),
}
```
**POST** accepts/negotiates a demand:
```typescript
// body: { demandId, action: "accept" | "negotiate", negotiatedPrice?: number }
// Creates ArtisanOrder with 14-day default deadline
```

#### [NEW] `src/app/api/artisan/orders/log/route.ts`
Auth-protected. **POST** adds a log to an order (validates ownership). Body: `{ artisanOrderId, note?, imageUrl? }`.

### 6.3 i18n Keys
```
"orders_title": "My Orders"
"orders_summary": "Orders Summary"
"orders_total_accepted": "Demands Accepted"
"orders_total_earned": "Total Earned"
"orders_your_rating": "Your Rating"
"orders_current": "Current Orders"
"orders_raised_demands": "Raised Demands"
"orders_no_current": "No current orders. Check Raised Demands to find work!"
"orders_no_demands": "No matching demands found for your craft type."
"orders_accept": "Accept"
"orders_negotiate": "Negotiate"
"orders_deadline": "Deadline"
"orders_days_left": "{days} days left"
"orders_add_log": "Add Daily Update"
"orders_log_placeholder": "What did you work on today?"
"orders_log_photo": "Add Progress Photo"
"orders_log_submitted": "Log added!"
"orders_accepted_toast": "Demand accepted! Check Current Orders."
"orders_negotiate_price": "Your Price"
"orders_send_offer": "Send Offer"
```

---

## 7. FEATURE 5 — AUTONOMOUS KARIGARI ASSISTANT

### 7.1 What It Does
Upgrade the existing assistant (`VoiceOnboarding` + `AssistantChat`) to an **autonomous** assistant that:
- **Knows the current page** context and can perform actions
- **Opens modals**, fills forms, navigates pages on behalf of the user
- **Listens to voice** and transcribes into form fields
- **Stays active** until the task is complete (doesn't dismiss after one message)
- **Asks for missing data** if user doesn't provide everything needed

### 7.2 Architecture — Action Command System

The assistant API returns `{ reply, action? }` where `action` is a structured command the client dispatches:

```typescript
type AssistantAction =
  | { type: "OPEN_CAPTURE" }
  | { type: "OPEN_PROFILE" }
  | { type: "NAVIGATE"; path: string }
  | { type: "OPEN_DEMAND" }
  | { type: "FILL_FIELD"; field: string; value: string }
  | { type: "SUBMIT_FORM" }
  | { type: "NONE" }
```

The client dispatches actions via `CustomEvent` on `window`:
- `karigari:assistant-action` — for modal/navigation actions
- `karigari:fill-field` — for form field population

### 7.3 Files to Modify

#### [MODIFY] `src/app/api/voice-assistant/route.ts`
Enhance to accept `context: { currentPage, openModal?, formState? }` in the request body.

Use Gemini with a system prompt listing all platform capabilities and the current page context. Parse user intent → return `{ reply, action }`.

**Graceful degradation** (keyword matching when Gemini unavailable):
- "draft"/"capture"/"new item" → `OPEN_CAPTURE`
- "profile"/"edit profile" → `OPEN_PROFILE`
- "dashboard" → `NAVIGATE /artisan/dashboard`
- "orders" → `NAVIGATE /artisan/orders`
- "cluster" → `NAVIGATE /artisan/cluster`
- "schemes" → `NAVIGATE /artisan/schemes`
- etc.

#### [MODIFY] `src/components/VoiceOnboarding.tsx`
1. Track `currentRoute` (already a prop) and pass to API as context
2. Dispatch actions via custom events when API returns them
3. Keep conversation open — don't auto-close after one exchange
4. Add **continuous listening mode**: after assistant speaks, auto-start listening for the next user input
5. Show a persistent session indicator ("I'm still listening…")

#### [MODIFY] `src/app/artisan/dashboard/page.tsx`
**File:** `src/app/artisan/dashboard/page.tsx` (1018 lines)

Listen for assistant action events:
```typescript
useEffect(() => {
  const handler = (e: CustomEvent) => {
    const action = e.detail;
    if (action.type === 'OPEN_CAPTURE') setIsModalOpen(true);
    if (action.type === 'OPEN_PROFILE') setIsProfileEditorOpen(true);
  };
  window.addEventListener('karigari:assistant-action', handler as EventListener);
  return () => window.removeEventListener('karigari:assistant-action', handler as EventListener);
}, []);
```

#### [MODIFY] `src/components/CaptureModal.tsx`
Listen for `karigari:fill-field` events and map to form state:
```typescript
useEffect(() => {
  const handler = (e: CustomEvent) => {
    const { field, value } = e.detail;
    // Map field names to setState calls
  };
  window.addEventListener('karigari:fill-field', handler as EventListener);
  return () => window.removeEventListener('karigari:fill-field', handler as EventListener);
}, []);
```

### 7.4 i18n Keys
```
"assistant_listening": "Listening..."
"assistant_processing": "Processing..."
"assistant_ready": "I'm ready to help! What would you like to do?"
"assistant_opening_capture": "Opening the capture form for you..."
"assistant_opening_profile": "Opening your profile editor..."
"assistant_navigating": "Taking you to {page}..."
"assistant_need_more_info": "I need a bit more information."
"assistant_task_complete": "All done! Anything else?"
"assistant_continuous_mode": "I'm still listening. Tell me what's next."
```

---

## 8. FEATURE 6 — AI-POWERED SMART CAPTURE (STEP 1 DRAFT)

### 8.1 What It Does
In Step 1 of the CaptureModal (initial description), the AI:
1. Reads/listens to the artisan's product description
2. **Asks follow-up questions** (max 2-3) based on product type until bare minimum data is extracted
3. Questions are domain-specific:
   - Silk saree → "Which type of silk? (Muga, Tussar, Mulberry)"
   - Pottery → "What clay type? What firing technique?"
   - Metalwork → "Which metal? What casting method?"
4. Only asks for proof/registration in **rare edge cases** (e.g., claiming Muga silk at cotton prices)
5. Auto-populates extracted data into the form
6. **90% of the time**: 1-2 questions, then proceed. Don't over-ask.

### 8.2 Files to Create

#### [NEW] `src/app/api/items/smart-draft/route.ts`
Auth-protected (ARTISAN). Conversational endpoint:

POST body: `{ craftType, description, previousQuestions: string[], previousAnswers: string[] }`

Uses Gemini with a system prompt:
```
You are a craft documentation assistant. Extract BARE MINIMUM data:
1. Craft type  2. Materials used (specific)  3. Techniques  4. Labor time estimate  5. Certifications
Rules:
- Ask at MOST 3 follow-up questions. Usually 1-2 is enough.
- If enough info provided, say "I have everything I need."
- Only ask for proof in RARE edge cases (claimed protected designation + inconsistent pricing)
- 90% of the time, just extract data and move on.
```

Response:
```typescript
{ success: true;
  status: "need_more_info" | "complete" | "verification_needed";
  question?: string;
  extractedData: { craftType, material?, technique?, estimatedLaborDays?, specialNotes? };
  verificationNote?: string;
  readyToProceed: boolean; }
```

**Graceful degradation**: If Gemini fails → return `readyToProceed: true` immediately.

### 8.3 Files to Modify

#### [MODIFY] `src/components/CaptureModal.tsx`
In Step 1 of the wizard, add the AI draft conversation:
1. After artisan provides initial description, call `POST /api/items/smart-draft`
2. If `status === "need_more_info"`, show the question in a chat-like card within Step 1
3. Artisan answers → send accumulated Q&A back → repeat (max 3 rounds)
4. When `readyToProceed`, auto-populate form fields from `extractedData`
5. Add "Skip AI questions" button to bypass entirely

**UI within Step 1:**
```tsx
<div className="bg-[var(--color-mint)] rounded-xl p-4 border border-[var(--color-sage)]/50 mb-4">
  <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-2 flex items-center gap-2">
    <Bot size={14} /> {t("smart_draft_title")}
  </h4>
  {/* Chat thread: alternating AI questions and artisan answers */}
  {/* Input field for answering current question */}
  {/* "Skip" button */}
</div>
```

### 8.4 i18n Keys
```
"smart_draft_title": "AI Draft Assistant"
"smart_draft_analyzing": "Analyzing your craft..."
"smart_draft_question": "Quick question about your craft:"
"smart_draft_complete": "Got everything I need. Proceeding to next step."
"smart_draft_answer_placeholder": "Type your answer..."
"smart_draft_or_speak": "or speak your answer"
"smart_draft_verification_needed": "This product may require additional verification."
"smart_draft_skip": "Skip AI Questions"
```

---

## 9. NEW & MODIFIED FILES CHECKLIST

### New Files (15 files)
| File | Feature |
|------|---------|
| `src/components/DemandRecommendation.tsx` | F1 |
| `src/app/api/demand/recommend/route.ts` | F1 |
| `src/components/ReviewSection.tsx` | F2 |
| `src/components/ui/StarRating.tsx` | F2 |
| `src/app/api/reviews/route.ts` | F2 |
| `src/app/api/reviews/artisan/route.ts` | F2 |
| `src/app/artisan/cluster/page.tsx` | F3 |
| `src/app/artisan/cluster/loading.tsx` | F3 |
| `src/app/api/artisan/cluster-members/route.ts` | F3 |
| `src/app/api/artisan/resource-request/route.ts` | F3 |
| `src/app/artisan/orders/page.tsx` | F4 |
| `src/app/artisan/orders/loading.tsx` | F4 |
| `src/app/api/artisan/orders/route.ts` | F4 |
| `src/app/api/artisan/orders/log/route.ts` | F4 |
| `src/app/api/items/smart-draft/route.ts` | F6 |

### Modified Files (16 files)
| File | Feature(s) |
|------|------------|
| `prisma/schema.prisma` | F2, F3, F4 |
| `src/components/PostDemandModal.tsx` | F1 |
| `src/app/marketplace/product/[id]/ProductClient.tsx` | F2 |
| `src/components/ui/ProductCard.tsx` | F2 |
| `src/app/api/items/market/route.ts` | F2 |
| `src/app/register/page.tsx` | F3 |
| `src/app/api/auth/register/route.ts` | F3 |
| `src/components/ui/AppShell.tsx` | F3, F4 |
| `src/app/api/voice-assistant/route.ts` | F5 |
| `src/components/VoiceOnboarding.tsx` | F5 |
| `src/app/artisan/dashboard/page.tsx` | F5 |
| `src/components/CaptureModal.tsx` | F5, F6 |
| `src/lib/i18n/en.ts` | ALL |
| `src/lib/i18n/hi.ts` | ALL |
| `src/lib/i18n/or.ts` | ALL |
| `src/lib/i18n/te.ts` | ALL |

---

## 10. GUARDRAILS

- **No hardcoded / fake numbers** on any UI. Every stat is from the DB.
- **No browser `alert()` or `confirm()`**. Use in-app toast/banner components.
- **No external brand colors.** Use KARIGARI palette exclusively.
- **Honesty**: assistant never claims to submit to real government systems.
- **Preserve immutable ledger** via `logCraftItemEvent` for any CraftItem status changes.
- **AI graceful degradation**: every AI feature MUST work (reduced form) when `GEMINI_API_KEY` is missing. Use `estimateCraftValuation()` and keyword heuristics.
- **Images**: data URLs in PostgreSQL. No S3. `unoptimized` prop on `<Image>` for data URLs. Guard empty `src`.
- **i18n**: every new string in ALL 4 language files. Never hardcode English in JSX.
- **Auth**: buyer routes are public. Artisan routes check `decoded.role === 'ARTISAN'`. Admin routes check `decoded.role === 'ADMIN'`.
- **No new npm dependencies** — everything needed (Gemini, Prisma, lucide-react, etc.) is already installed.

---

## 11. IMPLEMENTATION ORDER

Execute in this exact sequence:

1. **Schema changes** (Section 2) → `npx prisma db push && npx prisma generate` → restart dev server
2. **Feature 1** — AI Demand Recommendation (self-contained)
3. **Feature 2** — Ratings & Reviews (needs Review model)
4. **Feature 3** — Artisan Clusters (needs ResourceRequest model + shgGroupLink)
5. **Feature 4** — Artisan Orders (needs ArtisanOrder + OrderLog + reviews for rating stat)
6. **Feature 6** — Smart Capture Draft (self-contained API + CaptureModal)
7. **Feature 5** — Autonomous Assistant (last — integrates with everything above)

---

## 12. VERIFICATION

```bash
npx tsc --noEmit && npm run build && npm run lint
```

Then manually:

- [ ] **F1**: `/buyer` → "Post New Demand" → craftType="Silk Saree", qty=50, material="Muga Silk", price max=₹1000 → AI warns price too low
- [ ] **F1**: Reasonable values → AI confirms "looks good"
- [ ] **F2**: `/marketplace` → product card shows star rating → product page shows reviews
- [ ] **F2**: Non-buyer sees "Only purchased buyers can review" → buyer who purchased can submit review with images
- [ ] **F3**: Register with SHG link → `/artisan/cluster` → see SHG members
- [ ] **F3**: Register without SHG link → auto-cluster by same location
- [ ] **F3**: Post resource request → cluster member sees and accepts it
- [ ] **F4**: `/artisan/orders` → summary stats are real data
- [ ] **F4**: "Raised Demands" tab → matching demands by craft type → Accept → appears in "Current Orders"
- [ ] **F4**: Add daily log (text + photo) to current order
- [ ] **F5**: Voice assistant → "draft a new item" → CaptureModal opens
- [ ] **F5**: "take me to orders" → navigates to `/artisan/orders`
- [ ] **F5**: Assistant stays active, keeps asking until task complete
- [ ] **F6**: CaptureModal Step 1 → describe "Muga Silk Saree" → AI asks 1-2 follow-up questions → auto-fills form
- [ ] **F6**: Gemini unconfigured → capture proceeds normally (skip AI questions)
- [ ] All 4 languages render without missing keys
- [ ] No console errors, no build warnings

Report: files touched, line counts, root causes, verification outcome.
