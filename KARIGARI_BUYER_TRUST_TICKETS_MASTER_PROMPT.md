# KARIGARI — Buyer Trust, QR Scan & Tickets/Reports Master Prompt

You are working inside the KARIGARI Next.js 15 app (App Router, TypeScript, Prisma + Postgres, Tailwind). Follow the codebase conventions already in place. Nothing is to be hard-coded, mocked with fake JSON, or shortcut-inlined — every value must come from Prisma, existing helpers, or genuine user input, and every UI state must react in real time to the DB.

Repo root: `KARIGARI/` (this file lives here).
Prisma schema: `prisma/schema.prisma`.
Auth: JWT cookie `auth-token`, decoded in existing API routes (see `src/app/api/artisan/dashboard/route.ts` for the pattern). Buyer identity: `src/lib/buyerIdentity.ts` (free-text name in localStorage, matches `Demand.buyerName` case-insensitively).
Admin shell + tabs: `src/components/AdminShell.tsx` (`AdminShell`, `TabBar`, `LiveBadge`) + `useUrlTab` from `src/lib/urlTab.ts`.
Admin nav rail: `src/components/ui/Sidebar.tsx` (add new deep-linked items with `?tab=...`).
Image compare (Gemini Vision + fallback): `src/lib/gemini.ts` → `generateContentWithFallback`. Existing usage: `src/app/api/buyer/orders/verify/route.ts`.

Implement the features BELOW STRICTLY IN ORDER. Do not begin feature N+1 until feature N compiles, its DB schema/migrations are applied, and its UI has been manually walked through end-to-end. All three features are connected — feature 2 depends on feature 1's verify page, feature 3 (bugfix) is independent and can be done last with the QA sweep.

---

## FEATURE 1 — Buyer scan-and-verify + Admin Tickets & Reports (guilty/not-guilty flow, artisan health score)

### 1.1 Prisma schema changes (`prisma/schema.prisma`)

Add a new `Ticket` model. Do not touch unrelated fields.

```
model Ticket {
  id                 String    @id @default(uuid())
  // The verification attempt that spawned this report
  craftItemId        String
  craftItem          CraftItem @relation(fields: [craftItemId], references: [id])
  demandId           String?
  patchId            String
  // Free-text buyer identity, same convention as Demand.buyerName / CraftItem.buyerName
  buyerName          String
  buyerContact       String?
  // The photo the buyer uploaded at verification time (data URL)
  buyerImageUrl      String
  // Snapshot of the artisan's original capture at ticket-creation time
  artisanImageUrl    String?
  // The AI similarity score from the failed verification (0-100)
  similarityScore    Float?
  aiReasoning        String?
  // OPEN | RESOLVED_GUILTY | RESOLVED_NOT_GUILTY | DISCARDED
  status             String    @default("OPEN")
  // Populated only when admin resolves NOT_GUILTY and writes a note
  adminNote          String?
  resolvedByAdminId  String?
  resolvedAt         DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@index([status])
  @@index([buyerName])
  @@index([craftItemId])
  @@index([createdAt])
}
```

Add a back-relation `tickets Ticket[]` on `CraftItem`.

Add on `ArtisanProfile` (NOT on User; healthScore already lives here):
```
verifiedGenuineCount   Int @default(0)   // increments 1 per successful buyer scan (feature 1.4)
```
(This is used to award +2.5% per correct demand up to a hard cap of 100 — see 1.6.)

Run `npx prisma migrate dev --name buyer_tickets_and_health_stats` and regenerate the client. Confirm the app still builds.

### 1.2 Camera-scan icon on Buyer → My Orders (`src/components/BuyerOrders.tsx`)

The existing `VerifyForm` inside this file already contains:
- a patch-id text input,
- a "Scan QR" button (currently a no-op / label only),
- a file input labelled "Upload received photo".

Do NOT create a second flow. Extend the existing one:

1. Replace the placeholder "Scan QR" button with a real camera scanner icon (`Camera` from `lucide-react`, sized/coloured to match the theme — `text-primary` on the mint pill background used elsewhere in this file). Clicking it must open a full-screen camera modal (mobile-first). Use `<input type="file" accept="image/*" capture="environment">` as the baseline (works on every phone browser without extra deps). If BarcodeDetector API is available in the browser, opportunistically decode a QR frame from the video stream and auto-fill `patchId` from the decoded URL (see feature 2 for the URL format). Otherwise fall back to the file input for the received-product photo AND leave patchId as a manual field.
2. The camera button must NOT be placed next to the patch-id input as a decoration. Add it also as a prominent icon-button at the top of the "My Orders" card header (right side, matching the theme), so a buyer can start "Scan & Verify" without first typing a patch ID. This top-level icon opens the same modal but routes to a dedicated verify page (see 1.3) with the demandId in query.

Do not hard-code the icon colour — reuse `text-primary`, `bg-[var(--color-mint)]`, `kg-press`, etc.

### 1.3 Dedicated buyer verify page (`src/app/buyer/verify/page.tsx`)

Create a new client page that the top-level scan icon links to:

- Reads `?demandId=<uuid>` from the URL (optional; a scan without a demand can still be run against any purchased item by buyer name).
- Two inputs required from the buyer:
  1. Patch ID (text; auto-filled if arriving from a QR scan — see feature 2).
  2. Image of the received product (from camera or file — 2 MB cap, data URL, matching the existing 2 MB limit in `src/app/api/buyer/orders/verify/route.ts`).
- On submit, POST to a NEW endpoint `POST /api/buyer/verify-item` (do NOT reuse `/api/buyer/orders/verify` because that one is scoped to a `demandId` and mutates `Demand.deliveryVerified` — this new flow may be triggered outside a demand match). See 1.4.
- Render the three-check result card (reuse `VerificationCard` component logic; extract it into `src/components/BuyerVerifyResult.tsx` if it is currently private to `BuyerOrders.tsx` — DO NOT duplicate).
- If the AI says the product does NOT match, render a prominent **"Report this product"** button. Clicking it POSTs to `POST /api/buyer/tickets` (see 1.4) with the failed verification payload, then swaps the button for a confirmation card that shows the ticket id and the message "The admin will review your report."

### 1.4 New API routes

Create `src/app/api/buyer/verify-item/route.ts` — same Gemini compare logic as `src/app/api/buyer/orders/verify/route.ts`, but:
- Looks up the `CraftItem` by `patchId` regardless of demandId.
- If `demandId` is present AND belongs to this buyer, also updates the demand's `deliveryVerified`/`deliveryScanScore` fields (do this by delegating to the SAME code path — extract a helper `verifyBuyerImage()` into `src/lib/buyerVerify.ts` and have BOTH endpoints call it, so the AI logic exists in one place).
- Returns `{ success, patchIdValid, productMatch, artisanMatch, similarityScore, reasoning, artisanName, craftItemId, artisanImageUrl }`. The `craftItemId` and `artisanImageUrl` are what the ticket-creation endpoint needs.
- On a successful genuine verification, **increment `ArtisanProfile.verifiedGenuineCount` by 1 and bump `healthScore` by 2.5 (capped at 100)** — this must happen inside a Prisma transaction with the same DB write that persists the verification. See 1.6.

Create `src/app/api/buyer/tickets/route.ts`:
- `POST` — body: `{ craftItemId, patchId, buyerName, buyerContact?, demandId?, buyerImageUrl, similarityScore, aiReasoning }`. Verifies the craftItem exists, snapshots `craftItem.images[0]` into `artisanImageUrl`, creates a `Ticket` row with `status: "OPEN"`, and writes an `AuditLog` entry (`action: "TICKET_OPENED"`). Returns `{ success, ticketId }`.
- `GET` — buyer-facing list for one buyer name: `?buyer=<name>`. Returns their own tickets with `status` so the buyer's page can show "discarded / refund initiated" states (see 1.5).

Create `src/app/api/admin/tickets/route.ts`:
- `GET` — admin-only (JWT role check, same pattern as `src/app/api/admin/dashboard/route.ts`). Optional `?status=OPEN|RESOLVED_GUILTY|RESOLVED_NOT_GUILTY` filter, default returns all. Returns tickets with joined `craftItem` (id, patchId, craftType, images[0], artisan { id, name, artisanProfile { healthScore, verifiedGenuineCount } }).

Create `src/app/api/admin/tickets/[id]/resolve/route.ts`:
- `POST` — admin-only. Body: `{ verdict: "GUILTY" | "NOT_GUILTY", note?: string }`.
- `GUILTY` flow (transactional):
  1. `Ticket.status = "RESOLVED_GUILTY"`, `resolvedAt`, `resolvedByAdminId = decoded.userId`.
  2. Decrease the artisan's `healthScore` by 15 (floor 0) — read the current value, subtract, write back. Do NOT decrement `verifiedGenuineCount` on penalties.
  3. Write an `AuditLog` `action: "TICKET_RESOLVED_GUILTY"`.
  4. Set the offending `CraftItem.status` to `"FLAGGED_REFUND_INITIATED"` (do not touch escrow — that flow is out of scope; simply mark it so the buyer's My Orders card can render the refund banner).
- `NOT_GUILTY` flow:
  1. `Ticket.status = "RESOLVED_NOT_GUILTY"`, `adminNote = note?.trim() || null`, `resolvedAt`, `resolvedByAdminId`.
  2. Write an `AuditLog` `action: "TICKET_RESOLVED_NOT_GUILTY"`.
  3. Do NOT change the artisan's health score.
- Return `{ success, ticket }`.

Every route above must:
- Return `NextResponse.json`, use `export const dynamic = 'force-dynamic'`.
- Reject with 400/403 on bad input or wrong role (copy the exact pattern already used in the file next door — never invent a new auth shape).
- Never persist raw base64 above the existing 2 MB per-image cap.

### 1.5 Buyer-side reflections

Extend `src/app/api/buyer/orders/route.ts` (GET) to also return, for each order, the list of `Ticket` rows the buyer has raised against that order's items — shape: `tickets: [{ id, status, adminNote, resolvedAt }]`. Then in `src/components/BuyerOrders.tsx`, below the verification block:

- If any `ticket.status === "OPEN"`, render an amber pill "Report under review".
- If any `ticket.status === "RESOLVED_NOT_GUILTY"`, render a neutral card: "Your report was reviewed and discarded." + `ticket.adminNote` when present (label it "Reason from admin").
- If any `ticket.status === "RESOLVED_GUILTY"`, render a green card: "A refund will be initiated. We are sorry for the inconvenience." — use the existing green-check styling (`bg-[var(--color-mint)]`, `border-[var(--color-sage)]`, `text-primary`).

Nothing here is hard-coded copy — pull the strings through `useLanguage`/`t(...)` like the rest of the file, adding new keys to `src/lib/i18n/en.ts` (English is the source; other locales fall through automatically).

### 1.6 Artisan-side reflections

Extend `src/app/api/artisan/dashboard/route.ts` to include:
- `healthScore` (already present at `user?.artisanProfile?.healthScore`; keep it).
- `verifiedGenuineCount` from `ArtisanProfile`.
- `openTickets`, `guiltyTickets`, `notGuiltyTickets` — counts of Tickets whose `craftItem.artisanId === decoded.userId`.
- `recentGuiltyTickets` — the last 5 tickets against this artisan resolved GUILTY, each with `{ id, craftItem: { craftType, images[0], patchId }, resolvedAt }`.

In `src/app/artisan/dashboard/page.tsx`, add a compact "Trust & Reports" card (place it near the existing health-score / earnings tiles — do not shove it at the bottom; match the existing StatCard/Card layout). It must show:
- Current health score (out of 100), as a live figure — do NOT hard-code the max, read it from the API response.
- The `verifiedGenuineCount` with a subtitle "verified genuine deliveries (+2.5% each, cap 100)".
- Open / resolved ticket counts.
- The recent GUILTY ticket list, each row showing the item image, patch id, "Guilty verdict", and the natural text "We are sorry — a refund is being processed. Your health score has decreased by 15%."

Health-score math (single source of truth, put in `src/lib/artisanHealth.ts`):
- `+2.5` on each verified-genuine buyer scan (in `verifyBuyerImage` helper).
- `−15` on each GUILTY verdict (in the ticket resolve route).
- Bounded to `[0, 100]`. Never negative, never above 100.
- Exported constants: `HEALTH_PENALTY_GUILTY = 15`, `HEALTH_REWARD_VERIFIED = 2.5`, `HEALTH_MAX = 100`, `HEALTH_MIN = 0`. Every reader/writer uses these constants — never a literal.

### 1.7 Admin "Tickets & Reports" tab

Add a new admin surface. Put it as its own tab on the existing Facilitator page rather than a separate page (Facilitator is the field-oversight console; Tickets & Reports belongs there):

1. Edit `src/app/admin/facilitator/page.tsx`:
   - Extend the union `useUrlTab<"qa" | "cluster">` to `"qa" | "cluster" | "tickets"` and pass `"tickets"` in the allowed tuple.
   - Add a third `TabBar` entry `{ key: "tickets", label: "Tickets & Reports", icon: <ShieldAlert size={16} /> }`.
   - Render a new component `<TicketsReports />` when `tab === "tickets"`.

2. Create `src/components/admin/TicketsReports.tsx` (client component):
   - Polls `GET /api/admin/tickets?status=OPEN` every 15 s using the same `POLL_MS` constant style already in the file.
   - Renders each open ticket in an expandable card:
     - Side-by-side comparison: LEFT = `craftItem.images[0]` labelled "Artisan capture"; RIGHT = `ticket.buyerImageUrl` labelled "Buyer photo".
     - Metadata: patch id, buyer name, craft type, artisan name, current health score, AI similarity %, AI reasoning.
     - Below: two large buttons — "Guilty" (red / `bg-[var(--color-maroon)]` if defined, else `bg-red-600`) and "Not guilty" (neutral). Selecting "Not guilty" reveals an optional textarea "Message to buyer (optional)". Then a "Submit verdict" button POSTs to `/api/admin/tickets/[id]/resolve`.
     - On success, refetch the list (no full page reload).
   - Include a sub-filter (Open | Resolved | All) that changes the `?status=` query.

3. Add a nav rail entry in `src/components/ui/Sidebar.tsx` under the Facilitator group:
   ```
   { href: "/admin/facilitator?tab=tickets", label: "nav_tickets_reports", icon: <ShieldAlert size={19} strokeWidth={1.6} />, match: ["/admin/facilitator"] }
   ```
   Add the i18n key `nav_tickets_reports` in `src/lib/i18n/en.ts`. Do NOT hard-code the English string in the sidebar.

4. All ticket counts/badges must be live: pass `openTickets` from the Facilitator queue response (or add it to a dedicated tickets stats endpoint) and render it as a `LiveBadge`/tab badge like the existing flag counter.

### 1.8 Dynamism guarantees for Feature 1

- No hard-coded ticket data or seed rows for testing — Tickets are created ONLY by the buyer flow.
- No hard-coded artisan / product / image references anywhere. Every image renders from `craftItem.images[]` or `Ticket.buyerImageUrl`, never a static path in `public/`.
- Polling intervals reuse the existing `POLL_MS = 15000` constant style from `admin/facilitator/page.tsx`. Extract a shared `src/lib/pollingIntervals.ts` if you need to reference it from three or more places.
- Every new i18n string is added to `src/lib/i18n/en.ts`. Never leave a literal string in JSX for user-facing copy.
- No `useState` initial values that mimic backend rows.

Feature 1 is done when: a buyer can open Buyer → My Orders, tap the camera icon (either the top-level one or the one in the verify sub-form), take/upload a photo, enter a patch id, submit, and see either the three-check pass card OR the failure card with a working Report button; the admin sees the ticket appear within 15 s on Tickets & Reports; a Guilty verdict drops the artisan's health score by 15 and shows the refund banner on the buyer side + the guilty entry on the artisan dashboard; a Not-Guilty verdict with an optional note shows a "discarded" card with the note on the buyer side.

---

## FEATURE 2 — QR code carries verify-URL + patchId; scanning routes / auto-fills

Do NOT begin this until feature 1 verifies end-to-end.

### 2.1 QR payload

Current QR content: the public passport URL `${origin}/verify/${patchId}` (see `src/components/QrAttachModal.tsx` around the `verifyUrl` computation). Extend it so the QR carries **both** pieces of data as a URL with a query param:

`${origin}/verify/${patchId}?scan=1`

The path segment IS the patchId — do not add it a second time in the query. `?scan=1` is the marker that the QR (not a manual visit) is the source. This keeps external phone-camera scans (Google Lens, plain camera app) working: they land on the existing `/verify/[patchId]` passport, exactly as they do today.

Change the QR content in `src/components/QrAttachModal.tsx`:
```ts
const verifyUrl = `${origin}/verify/${patchId}?scan=1`;
```
Regenerate the printable PNG from this new URL (the existing `downloadQr()` rasteriser is unchanged).

### 2.2 In-app scan from the buyer verify page

In the buyer camera modal (feature 1.2) and on `src/app/buyer/verify/page.tsx`, when a scanned QR is decoded:

1. Parse the URL. If the origin matches `window.location.origin` AND the path starts with `/verify/`, extract the patchId from the URL segment.
2. Autofill the patch-id input with that patchId.
3. Do NOT navigate away — the buyer is already on the verify page and still needs to upload the received-product photo.
4. Then, once the buyer submits, `/api/buyer/verify-item` runs the three checks:
   - `patchIdValid`: the patchId resolves to a real CraftItem.
   - `productMatch`: the Gemini similarity ≥ 75 (reuse `MIN_SIMILARITY` constant from `/api/buyer/orders/verify/route.ts` — extract it into `src/lib/buyerVerify.ts` if not already).
   - `qrValid`: NEW. If the buyer arrived via `?scan=1`, the decoded URL's patchId must equal the CraftItem's `patchId`. If they typed it, this check is auto-pass. Expose it in the response as `qrValid: boolean` and render a fourth row in the `VerificationCard` when applicable.
5. If any of the three (patchId, product, qr) fails, the report button becomes visible as before.

If the buyer opens the phone's native camera and scans the sticker outside the app, they land on the existing `/verify/${patchId}?scan=1` public passport — no changes needed there beyond ensuring `VerificationClient` reads `?scan=1` and renders a small pill "Scanned via QR" so the origin is visible. (Read the query with `useSearchParams` wrapped in a Suspense boundary if needed, or fall back to `window.location.search` inside a `useEffect` — this codebase already uses the latter pattern in `src/lib/urlTab.ts`.)

### 2.3 Real QR decoding

Use `@zxing/browser` (small, well-maintained, no wasm blob) for the in-app scanner. Add it to `package.json` dependencies via `npm install @zxing/browser`. In the scanner modal:

```ts
import { BrowserQRCodeReader } from "@zxing/browser";
```

Wire the reader to a `<video>` element, get the decoded text, close the stream, and process as in 2.2. On any failure (camera denied, no QR detected within 15 s), leave the manual patch-id input operable and show a small "Enter code manually" hint. Never crash the page.

### 2.4 Dynamism guarantees for Feature 2

- The QR URL is computed from `window.location.origin` and the item's real `patchId` — never a hard-coded domain.
- The `MIN_SIMILARITY` threshold is a single exported constant, referenced from the shared helper.
- No mocked scan results.

Feature 2 is done when: printing/downloading a QR from `QrAttachModal` yields `/verify/<patchId>?scan=1`; scanning it inside the buyer camera modal auto-fills the patch id AND passes the `qrValid` check; scanning it outside the app (Google Lens / phone camera) opens the passport page with the "Scanned via QR" pill.

---

## FEATURE 3 (BUGFIX) — Add Bills tab in Step 2 of "Capture new craft" is hard-coded

File: `src/components/CaptureModal.tsx`, block around lines 1943–1955 (the "Raw material proof" section).

Current code:
```jsx
<div className="w-full h-48 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors mb-6">
  <FileText size={40} className="mb-3 text-gray-400" />
  <span className="font-medium text-gray-700">{t('upload_bill')}</span>
  <span className="text-xs text-gray-400 mt-1">JPEG, PNG, or PDF</span>
</div>
```

It's a bare `<div>` with no `<input>` — that's why the file explorer never opens. Fix:

1. Wrap the block in a `<label>` (with `htmlFor` OR the `<input>` nested inside), pointing at a hidden `<input type="file" accept="image/jpeg,image/png,application/pdf" />`.
2. On change: read the file, enforce the same 2 MB cap used elsewhere in the modal (grep `2_000_000` or `2 * 1024 * 1024` for the existing constant — reuse, do NOT redefine), convert to a data URL via a `readFileAsDataUrl` helper (there's already one in `src/components/BuyerOrders.tsx` — either import it or promote it to `src/lib/fileToDataUrl.ts` and use it from both).
3. Store the resulting data URL in a new local state `billDataUrl` (mirrors the existing photo state in this modal).
4. Wire the value into the capture POST — `src/app/api/items/capture/route.ts` already accepts `rawMaterialProofUrl` on `CraftItem`; send `billDataUrl` there. If the API currently ignores this field, add support: accept a `rawMaterialProofUrl?: string` in the POST body, validate ≤ 2 MB data URL, persist to the row.
5. Show a small thumbnail preview once a bill is attached, with a "Remove" button that clears the state.
6. Keep the "Optional" phrasing and the fairness-score bonus copy exactly as-is (translated string).

Do NOT hard-code the accepted MIME list — pull from a shared constant if one exists, otherwise define ONE local constant `const BILL_ACCEPT = "image/jpeg,image/png,application/pdf";` and use it both in the `accept` attribute and in the validation.

Feature 3 is done when: clicking the bill dropzone opens the OS file picker, selecting a valid file shows a thumbnail, submitting the capture persists a non-null `rawMaterialProofUrl` on the resulting `CraftItem`.

---

## POST-IMPLEMENTATION QA (mandatory — do not skip)

After all three features are in, run this checklist and fix everything found. Report each fix in the same conversation with the failing case + patch.

1. `npx tsc --noEmit` — must be clean.
2. `npm run build` — must succeed. No `any` warnings introduced beyond what the codebase already tolerates.
3. `npx prisma migrate status` — the new Ticket + verifiedGenuineCount migration must be applied.
4. End-to-end walkthrough (no shortcuts, use the real UI):
   - Login as an artisan → capture a new craft → in Step 2, upload a bill file → confirm the OS picker opens and the thumbnail renders.
   - Approve the item as admin so it gets a patchId.
   - As the artisan, run the QR-attach flow → download the QR → confirm the encoded URL is `/verify/<patchId>?scan=1`.
   - Simulate a purchase / mark delivered.
   - As the buyer, open Buyer → My Orders → tap the top-level camera icon → land on `/buyer/verify?...` → upload a DELIBERATELY DIFFERENT photo (e.g. a stock image) → confirm the failure card + Report button appear.
   - Click Report → confirm the ticket appears in Admin → Tickets & Reports within 15 s.
   - Resolve as GUILTY → confirm the artisan's health score dropped by exactly 15 in the artisan dashboard and DB, and the buyer sees the refund banner within one poll cycle.
   - Repeat with a matching photo → confirm the three-check pass card and that `verifiedGenuineCount` increments by 1 and health score increases by 2.5 (capped at 100).
   - Resolve a fresh ticket as NOT_GUILTY with an admin note → confirm the buyer's "discarded" card shows the note.
5. Logical audits:
   - No hard-coded strings in JSX for the new UI (grep the new files for literal quoted English that is NOT wrapped in `t(...)`).
   - No hard-coded images, patch ids, buyer names, artisan names anywhere in the new code.
   - No `setTimeout` polls without cleanup on unmount.
   - No missing `await` on Prisma transactions.
   - Health-score math bounded: try to trigger a resolve on an artisan already at 5 (should floor to 0, not go negative), and a verified scan on an artisan at 99 (should cap at 100, not 101.5).
   - Idempotency: rapidly click "Submit verdict" twice on the same ticket — the second must no-op (either at the API layer with a `WHERE status = 'OPEN'` guard, or at the client with a submitting flag).
   - Race: buyer submits verify with a stale patch id (e.g. patch id that no longer exists after admin deletion) — must render the "Patch ID not found" branch, not crash.
6. Regression checks (do not break existing flows):
   - Existing `/api/buyer/orders/verify` still writes `deliveryVerified` on the Demand when called through the demand-scoped `VerifyForm` in `BuyerOrders.tsx`.
   - Existing `QrAttachModal` still verifies via `/api/items/attach-verify` (that route decodes the QR itself — confirm changing the encoded URL to include `?scan=1` still lets it match the patch id it minted for the item; adjust the decode regex in `attach-verify/route.ts` if it currently over-anchors on the URL).
   - Existing admin Facilitator "QA" and "Cluster" tabs still deep-link and function.
   - Existing artisan dashboard cards remain untouched.

Deliver the final report as: a short summary of every file touched + created, the exact Prisma migration name, and the QA checklist above with each item ticked. Any failure encountered during QA must be listed with its root cause and the follow-up patch.

END OF PROMPT.
