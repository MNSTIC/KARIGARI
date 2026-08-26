# MASTER PROMPT — KARIGARI Artisan & Buyer Flow Upgrade (8 work items)

> Paste this whole file into Claude Code as your task. It is self-contained and maps every change to exact files/lines in the repo. Work top to bottom; verify after each item.

---

## 0. ROLE & MISSION

You are a principal full-stack engineer on **KARIGARI** (SIH 2026, MoSJE PS 26090 — AI fairness protocol for handloom/handicraft artisans). Deliver the **8 work items** below: make hardcoded demo surfaces dynamic and DB-backed, move browser popups into in-app UI, make the voice assistant scheme-aware, wire buyer demand → forecast map → artisan notifications, and keep the digital passport and existing theme intact.

Quality bar: **dynamic (real DB data, no hardcoded arrays), working end-to-end, matches the existing theme, no console/build errors.** Demo-day software, judged live.

---

## 1. WHERE THE CODE IS

App root is **`KARIGARI-main/KARIGARI/`** (one level below the connected folder). `cd` there; run all commands there.

```bash
cd KARIGARI-main/KARIGARI
git status && git log --oneline -5
npm install
```

Stack: **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 7 (Postgres, adapter-pg) · Gemini**. Path alias `@/` = `src/`.
Next 16 rules: `await cookies()`, `searchParams` is a Promise. Copy the auth block from any `src/app/api/**/route.ts`. JWT payload is `{ userId, role }`, cookie `auth-token`, secret `process.env.JWT_SECRET || 'fallback-secret'`. After any `prisma generate`, **restart the dev server** (a stale client throws `Unknown argument`).

### Theme — follow it exactly (do NOT introduce new colors)
Tokens are in **`src/app/globals.css`** (Tailwind v4 `@theme`). The current palette:
- `--color-primary: #24332C` (dark green), `--color-primary-dark #1A2721`, `--color-primary-light #3D5145`
- `--color-background: #FCF8F7` (warm white), `--color-mint #DCEBE0`, `--color-sage #A9BFB0`, `--color-card #FFFFFF`
- warm neutral gray ramp + muted status ramps already redefined
- headings `font-serif` (Playfair), body `font-sans` (Inter); cards `rounded-2xl`, `shadow-card`, `border border-gray-100`; the `animate-fade-in-up` utility exists.
Use `bg-primary`, `text-primary`, `bg-[var(--color-mint)]`, etc. **For the WhatsApp simulation (item 1), use THIS palette — never WhatsApp's green.**

### i18n — keep it
Client components use `const { t, language } = useLanguage()` from **`src/lib/translations.ts`** (languages `en/hi/or/te`). Any new user-facing string must be translatable (add keys to `translations.ts`, or use the inline `language === 'or' ? ... : 'hi' ? ... : ...` pattern already in these files).

---

## 2. SCHEMA CHANGES FIRST (`prisma/schema.prisma`)

There is currently **no Demand and no Notification model** (only `User, ArtisanProfile, CraftItem, AuditLog, SchemeApplication`; enum `Role { ADMIN, ARTISAN }`). Items 4 & 5 need both. Add:

```prisma
model Demand {
  id              String   @id @default(uuid())
  craftType       String
  quantity        Int
  targetPriceMin  Float?
  targetPriceMax  Float?
  location        String?          // buyer's target region/city
  festival        String?          // optional occasion tag, e.g. "Diwali"
  buyerName       String?
  notes           String?
  status          String   @default("OPEN")   // OPEN | MATCHED | FULFILLED
  createdAt       DateTime @default(now())
  @@index([craftType])
  @@index([status])
  @@index([createdAt])
}

model Notification {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  type        String                          // DEMAND_ALERT | FESTIVAL | SCHEME | SYSTEM
  title       String
  message     String
  read        Boolean  @default(false)
  relatedDemandId String?
  channel     String?                         // "WHATSAPP" | "SMS" | "IN_APP" (for the item-1 sim)
  createdAt   DateTime @default(now())
  @@index([userId, read])
  @@index([createdAt])
}
```
Add `notifications Notification[]` to the `User` model. Then:
```bash
npx prisma db push && npx prisma generate   # then restart `npm run dev`
```
Seed a few `Demand` rows and `Notification` rows in **`prisma/seed.ts`** so every new surface renders with real data on first load. Festivals: create a small **`src/lib/festivals.ts`** constant (name + date + relevant crafts) rather than a DB model — the AI/insights logic reads upcoming festivals from it by date.

---

## 3. THE 8 WORK ITEMS

### ITEM 1 — WhatsApp simulation under "SMS Auto-Pilot" (make dynamic)
**File:** `src/app/artisan/insights/page.tsx`. The **SMS Auto-Pilot card is hardcoded static JSX at lines ~211–221** ("No internet? No problem", "WhatsApp / SMS Alerts Active"). The page already has a demo timer at lines ~32–39 (`newDemandAppeared`).
- Build a new **`src/components/WhatsAppSimulation.tsx`**: a minimal chat-style panel using the KARIGARI palette (e.g. incoming bubbles in `--color-mint`, dark-green accents — **not** WhatsApp green). A **"Run Simulation"** button plays a scripted sequence of demand-alert messages arriving (typing indicator → "📈 Demand spike: 50 Sambalpuri sarees for Diwali, ₹3,800/unit. Reply YES to auto-list." → artisan "YES" → "✅ Listed on ONDC"). Pure front-end demo; no real messaging.
- Feed the demo from **real data when available**: pull the latest `OPEN` Demand(s) matching the artisan's `craftType` (via a small fetch to the insights/demand API from item 4/5) so the simulated alert shows a real pending demand; fall back to a scripted message if none.
- Make the SMS Auto-Pilot status line dynamic (e.g. "Alerts Active" reflects whether the artisan has notifications enabled / has a `mobileNumber`). Replace the static block at lines ~211–221; keep the card styling.

### ITEM 2 — Capture model: in-app notifications + editable two-language description
**Files:** `src/components/CaptureModal.tsx`, `src/app/api/items/vision-verify/route.ts`, `src/app/api/items/capture/route.ts`.

**(a) Kill browser popups — replace every `alert()` with in-app UI.** `CaptureModal.tsx` uses native `alert()` at lines **127, 135, 166, 170, 187, 266, 271, 287, 317, 332**. The most important is **line 127** — the product-**REJECTED** popup (`alert("AI Vision Rejected: " + reasoning)`) followed by `setImages([])` at 128. Replace all with an in-app banner/toast rendered inside the modal (add state e.g. `visionRejected`/`rejectionReason` near the other vision states ~lines 62–64; render a red banner in the step-2 status region ~lines 519–536, mirroring the existing green "AI Verified" banner). Acceptance is already in-app (green banner ~531–536 and the step-4 success screen ~636–651) — keep/enhance, no alert needed there.

**(b) Fix the description bug.** `CaptureModal.tsx` lines **124–125** read `data.data.ecommerceDescriptionEnglish` / `ecommerceDescriptionLocal`, but `vision-verify/route.ts` returns **`descriptionEnglish` / `descriptionLocal`** (route lines ~57–58, schema ~50–61). Because of this mismatch the e-commerce listing is always empty and `aiGeneratedListing` saves blank. Align the keys so the bilingual listing populates.

**(c) Two-language description, editable before save.** Requirement: (1) an **English** listing = the version that goes to ONDC and is saved to the DB with the product; (2) a **second version in the artisan's own language** for them to review. Both must be **editable/addable** by the artisan before saving.
- Show both: the English listing (`descriptionEnglish` / `aiGeneratedListing`) and the regional one (`descriptionOriginal` — currently captured at line ~258 but **never displayed**). Convert the read-only `<p>` cards (~lines 448, 538–556) into `<textarea>`s bound to the description state so the artisan can edit/add.
- Persist edits: `handleSaveUpload` already sends `descriptionOriginal`, `descriptionEnglish`, `aiGeneratedListing` (body ~lines 149–158) and `capture/route.ts` saves them (~lines 111–113). Once fields are editable and correctly populated, edits flow through with no schema change. Make sure the English listing is what's stored as the ONDC listing text.

### ITEM 3 — Voice assistant: answer in preferred language + real scheme knowledge
**Files:** `src/app/api/voice-assistant/route.ts`, `src/components/VoiceOnboarding.tsx`, `src/lib/schemes.ts`, `src/lib/artisanEligibility.ts`.
Good news: the assistant **already** replies in the chosen language (romanized so browser TTS can speak it) — see `buildPrompt` (route lines ~86–124) and `VoiceOnboarding` `speakText` (uses `en-IN` TTS). Keep that. The gap is **scheme-specific knowledge**: when asked "tell me about PM Vishwakarma / what benefit do I get," it currently answers only from generic app-capability text and may be vague.
- In `voice-assistant/route.ts`, when the question is about schemes (or always), inject **real scheme facts** into the prompt from `src/lib/schemes.ts` (the `SCHEMES` catalog already holds name, benefit, eligibility, official portal per scheme). Add a compact scheme summary block to `buildPrompt`.
- Optionally personalize: call `loadEligibilitySnapshot(userId)` + `evaluateScheme` (from `src/lib/artisanEligibility.ts` / `src/lib/schemes.ts`) and tell the model which schemes this artisan is eligible for, so it can say "you qualify for NBCFDC, which gives …". Keep the reply to 1–2 spoken sentences in the artisan's language, and keep the existing rule: never claim to submit a government application.

### ITEM 4 — Buyer "Post New Demand" → dynamic, and feed the demand-forecast map
**Files:** `src/app/buyer/page.tsx`, `src/app/artisan/insights/page.tsx`, new API route(s), Demand model (item 2 above).
- `buyer/page.tsx`: the **"Post New Demand" button (~lines 48–50) has no `onClick`** and the page is all hardcoded simulation (`quoteState`, the REQ-99283 ticket ~63–68). Wire the button to a **form/modal** collecting `craftType, quantity, targetPriceMin, targetPriceMax, location, festival?, buyerName`. On submit, POST to a new **`src/app/api/demand/route.ts`** (`POST` creates a `Demand`; `GET` lists OPEN demands). Buyer has no auth/role in this app — allow the POST without a JWT (public demand board) or accept a `buyerName`; keep it simple and note it.
- **Demand-forecast map**: in `insights/page.tsx` the map pins are **hardcoded at lines ~89–177** (Delhi/Mumbai/Bangalore/Local, static numbers) over an OSM iframe. Replace the pins with a `.map()` over demands fetched from `GET /api/demand`, grouping by `location`. Each pin shows craft, quantity, target price, festival. A newly posted demand must appear here (drives the existing "New Buyer Demand" animation). Keep the OSM iframe; make the pins data-driven.

### ITEM 5 — Market insights AI: festival/high-demand → notify matched artisans
**Files:** `src/app/artisan/insights/page.tsx`, new `src/app/api/artisan/insights/route.ts`, `src/lib/gemini.ts`, `src/lib/festivals.ts` (new), Notification model.
- The "AI Recommendation" card in insights is **static text (~lines 192–209)**. Build a real endpoint: `GET /api/artisan/insights` (gate ARTISAN) that computes, from the DB + `festivals.ts`: (i) any festival within N days relevant to the artisan's `craftType`; (ii) demand pressure = count/sum of OPEN `Demand` rows matching their `craftType`. Feed those facts to `generateContentWithFallback` (from `gemini.ts`, signature `(contents, config?, models?)`) asking for a short structured JSON recommendation (detected trigger, suggested action, suggested price band bounded by `benchmarkData.ts`). Render that in place of the static card.
- **Notifications to matched artisans**: when a festival is near or a matching demand exists, create `Notification` rows (`type: 'DEMAND_ALERT' | 'FESTIVAL'`) for artisans whose `craftType`/`clusterName` matches. Surface them in the app: wire the **bell icon** (present in the dashboard/insights header) to a notifications dropdown reading `GET /api/artisan/notifications`, and let the item-1 WhatsApp simulation replay the latest `DEMAND_ALERT`. This is the "AI tells us to send a notification to the matched artisan" requirement — make it real rows, not a toast.

### ITEM 6 — Product timeline in details, remove admin publish, real marketplace
**(a) Product "View Details" must show timeline + audit logs.** `src/app/artisan/dashboard/page.tsx` → `DetailsModal` (**lines ~375–431**) currently shows only image/price/labor — **no timeline**. The item's `auditLogs` are not even fetched (`api/artisan/dashboard/route.ts` `recentCaptures` at line ~53 has no `include: { auditLogs }`). Fix: include `auditLogs` for the artisan's items (add `include: { auditLogs: { orderBy: { createdAt: 'desc' } } }` to that query, or add a small `GET /api/artisan/item/[id]` that returns the item + audit logs, artisan-scoped). Then render a **Product Timeline** in `DetailsModal` — reuse the exact timeline UI already in `src/app/verify/[patchId]/VerificationClient.tsx` (lines ~159–198). Confirm audit logs are actually written on state changes (they are, via `logCraftItemEvent` in capture/verify/disbursement/simulate-sale routes).

**(b) Remove the manual "Publish" button; auto-attach the artisan's description on ONDC publish.** `src/app/admin/facilitator/page.tsx` has `publishItem` (**line ~213**, calls `/api/admin/verify-batch`) and a **"Publish" button in `VoiceQaCard` (~lines 649–654)** with toast "Listing published with a Patch ID." Requirement: remove the separate manual publish step so that when an item is approved/verified it is **automatically published to ONDC with the artisan's edited description attached**. Implement: on verify/approve (verify-batch, `src/app/api/admin/verify-batch/route.ts`), set `isListedOnMarketplace = true` and carry the artisan's `descriptionEnglish`/`aiGeneratedListing` onto the listing automatically (it's already on the CraftItem — ensure it's the text used as the ONDC listing). Drop the manual "Publish" button from the Voice QA card; the QA approval itself performs the publish. Keep the audit-log entry.

**(c) Marketplace: previous listings + new listing saving description.** `src/app/artisan/market/page.tsx` is **all hardcoded** (static "ONDC Network" and "Bulk Buyers" pitch tabs, inert buttons; no listings, no create form). Rebuild the artisan-facing part to: (i) show the artisan's **previous listings** from the DB (their `CraftItem`s where `isListedOnMarketplace` / has `patchId`), fetched via a new `GET /api/artisan/listings` (or extend the dashboard route); (ii) offer a **"New Listing"** action whose description is **saved to that CraftItem in the DB** (`descriptionEnglish`/`aiGeneratedListing`) — reuse `CaptureModal` or a lightweight listing form. Keep the ONDC/B2B info as secondary content.

### ITEM 7 — Scheme apply auto-fill assistant; digital passport intact; whole-flow check
**Files:** `src/app/artisan/schemes/page.tsx`, `src/app/api/artisan/schemes/apply/route.ts`, `src/lib/schemes.ts`, `src/lib/artisanEligibility.ts`, `src/app/verify/[patchId]/*`.
- **Apply already has** a self-declaration modal + tracker (`applyTarget`/`submitApply` in the page; `apply/route.ts` records `APPLIED`, never fakes a govt submission). **Add the missing piece: an auto-fill assistant.** When the artisan opens Apply for a scheme, generate a **pre-filled application form** from their profile (name, `aadhaarLast4`, `annualIncome`, `socialCategory`, `craftType`, `clusterName`, plus scheme-specific fields from `schemes.ts`), shown for review/edit, with a "download filled form" / "copy details" action to speed up the real portal submission. This is the "automatic assistant when filling a form for a scheme." Keep it honest — it prepares the form; the artisan still submits on the official portal.
- **Digital passport — keep intact.** `src/app/verify/[patchId]/page.tsx` queries the item **with `auditLogs`** and passes it to `VerificationClient.tsx`, which shows the product story (`descriptionOriginal` + `descriptionEnglish`, "The Item's Story" ~lines 132–155) and the Product Timeline (~159–198). Do **not** regress this while changing descriptions/marketplace — the passport must keep showing the story + timeline. Re-test the `/verify/[patchId]` page after item 2 and item 6 changes.
- **Whole-flow check:** walk artisan onboarding → capture (voice → vision → save, with editable bilingual description) → admin QA/auto-publish → marketplace listing → buyer demand → insights notification → passport. Fix breaks found along the way.

### ITEM 8 — Theme consistency + fix errors
- Every new UI uses the `globals.css` tokens (§1). No raw hex outside the token system; no WhatsApp green.
- Run and clear all issues you introduce:
```bash
npx tsc --noEmit && npm run build
```
Fix any TypeScript/build errors and any runtime console errors you encounter in the touched flows. (A repo-wide `npm run lint` currently reports pre-existing warnings — don't add new ones; files you touch must lint clean.)

---

## 4. NEW / CHANGED FILES CHECKLIST
- **Schema/seed:** `prisma/schema.prisma` (Demand, Notification), `prisma/seed.ts`, new `src/lib/festivals.ts`.
- **New components:** `src/components/WhatsAppSimulation.tsx`; a NotificationsDropdown (or inline in header); a scheme auto-fill form (in schemes page or `src/components/SchemeFormAssistant.tsx`).
- **New APIs:** `src/app/api/demand/route.ts` (GET/POST), `src/app/api/artisan/insights/route.ts`, `src/app/api/artisan/notifications/route.ts`, `src/app/api/artisan/listings/route.ts` (or extend dashboard route), optional `src/app/api/artisan/item/[id]/route.ts`.
- **Edited:** `artisan/insights/page.tsx` (WhatsApp sim + dynamic map + AI card), `buyer/page.tsx` (demand form), `components/CaptureModal.tsx` (alerts→UI, editable bilingual desc), `api/items/vision-verify/route.ts` (key names), `api/voice-assistant/route.ts` (scheme facts), `artisan/dashboard/page.tsx` DetailsModal (timeline) + `api/artisan/dashboard/route.ts` (include auditLogs), `admin/facilitator/page.tsx` + `api/admin/verify-batch/route.ts` (auto-publish, remove manual button), `artisan/market/page.tsx` (real listings), `artisan/schemes/page.tsx` (auto-fill assistant).

---

## 5. GUARDRAILS
- **No hardcoded data on any surface you touch** — read from the DB/APIs. (The demo timer/scripted WhatsApp sequence in item 1 is the only allowed scripted element, and it should prefer real demand data when present.)
- **No browser `alert()`/`confirm()`** in the capture flow — all feedback is in-app UI.
- **Honesty:** voice assistant and scheme apply never claim to submit to a government system; ONDC "publish" is the app's own listing flag, not a real ONDC API call — label it accordingly.
- **Don't break** the digital passport, the admin facilitator/nodal dashboards, the schemes engine, or artisan auth.
- **Theme + i18n:** use `globals.css` tokens and `useLanguage`; every new string translatable.
- **Audit trail:** any new `CraftItem` mutation calls `logCraftItemEvent` (`@/lib/auditLogger`).
- Restart dev server after `prisma generate`.

---

## 6. VERIFICATION (do all before done)
```bash
npx tsc --noEmit && npm run build   # clean
```
Then `npm run dev` and check:
1. Insights → SMS Auto-Pilot shows the WhatsApp simulation; "Run Simulation" plays alert messages in the KARIGARI palette; a real OPEN demand for the artisan's craft appears in it.
2. Capture: rejecting an image shows an **in-app red banner** (no browser popup); the English + own-language descriptions are shown and **editable**; saved item has both stored (check DB) and the English text is the ONDC listing.
3. Voice assistant: ask "tell me about <a scheme> and its benefit" in Hindi/Odia/Telugu → spoken answer in that language with the real benefit.
4. Buyer posts a demand → it persists and appears as a pin on the insights demand-forecast map; a matching artisan gets a Notification (bell dropdown) and it can replay in the WhatsApp sim.
5. Insights AI card reflects a real upcoming festival / demand from the DB, not static text.
6. Product "View Details" shows the timeline/audit logs; admin QA auto-publishes (no manual Publish button) and attaches the artisan's description; marketplace lists the artisan's previous listings and a new listing saves its description to the DB.
7. Scheme Apply shows a profile-prefilled form to review/download; `/verify/[patchId]` still shows the story + timeline.
8. No new TypeScript/build/console errors; theme consistent throughout.

Report new/edited/deleted files, the schema migration, and anything stubbed.
