# MASTER PROMPT — KARIGARI Bug-Fix & Feature Batch (13 items)

> Paste into **Claude Code** (it has the repo). Fix everything below, keep the build green, keep the green heritage theme, keep latency low. Work only inside the app root.

---

## 0. ORIENTATION (read first — do not skip)

**App root (nested one level down):** `KARIGARI-main/KARIGARI/` — `cd` there. `package.json` = `karigari-app`.

**Stack:** Next.js **16.3.1** App Router (Turbopack), React **19.2**, TypeScript 5, Prisma **7.9** + `@prisma/adapter-pg` (Postgres), Tailwind **v4**, `lucide-react`, `jsonwebtoken`, `recharts`, `react-qr-code`, `sharp`.

**⚠️ Next.js 16 is NOT your training-data Next.** `AGENTS.md`/`CLAUDE.md` say so. Before editing routes/dynamic pages read `node_modules/next/dist/docs/`. Key: dynamic `params` is a **Promise** (`const { id } = await params`), `cookies()` is **async** (`await cookies()`). Client pages that read query strings should parse `window.location.search` in a deferred `useEffect` (the pattern already used in `dashboard/page.tsx`) rather than `useSearchParams`, to avoid forcing a Suspense boundary.

**Conventions to match (do not reinvent):**
- Prisma: `import { prisma } from '@/lib/prisma'` (singleton). Never `new PrismaClient()`.
- Auth cookie is **`auth-token`** (hyphen). Reuse the `requireArtisan()` helper from `src/app/api/artisan/listings/route.ts`; admin routes verify `decoded.role === 'ADMIN'` (see `src/app/api/admin/verify-batch/route.ts`). `JWT_SECRET` fallback `'fallback-secret'`.
- Audit: `logCraftItemEvent({ prisma, craftItemId, actorId?, actorRole?, action, previousState?, newState?, comments? })` from `@/lib/auditLogger`. `craftItemId` is required + FK-bound.
- Money/pricing: `getListingPrice`, `formatRupees`, `estimateCraftValuation` from `@/lib/pricing`. Never hand-roll.
- Theme tokens in `src/app/globals.css` (`primary #24332C`, `primary-dark #1A2721`, mint `var(--color-mint)` `#DCEBE0`, sage `var(--color-sage)`). Use `bg-primary`, `text-primary`, `bg-[var(--color-mint)]`, `rounded-2xl`, `shadow-card`, `font-serif`. Everything responsive.
- i18n: `const { t, language, changeLanguage } = useLanguage()` from `@/lib/translations` (see §5).

**Finish:** run `npm run build` — all routes must compile with zero TS errors. Run `npx prisma generate` after any schema change.

---

## ⭐ 1. ROOT-CAUSE FIX THAT REPAIRS ISSUES #2, #3, #4 AT ONCE — Groq env var mismatch

**Diagnosis (confirmed):** every Groq call reads `process.env.GROQ_API_KEY`, but `.env` stores the key as **`GROK_KEY`** (set, 58 chars) while `GROQ_API_KEY` is **empty**. So Groq is unauthenticated everywhere → Whisper transcription fails (audio error, #3/#4), and Raw Materials + Live News fall to their error fallbacks (#2). Files affected: `src/lib/voiceParse.ts` (`groqKey()`), `src/app/api/artisan/generate-materials/route.ts`, `src/app/api/artisan/generate-news/route.ts`.

**Fix:**
1. In **`.env`** and **`.env.example`**: rename `GROK_KEY` → `GROQ_API_KEY` (keep the existing value). Also set the currently-empty `PUBLIC_BASE_URL` if you rely on it elsewhere.
2. Make key reads defensive everywhere Groq is used: `const key = (process.env.GROQ_API_KEY || process.env.GROK_KEY)?.trim() || null;` — do this in `voiceParse.ts` `groqKey()` and in both generate routes. This survives either spelling.
3. **Centralize** to kill drift: create `src/lib/groq.ts` exporting `groqKey()`, `GROQ_BASE='https://api.groq.com/openai/v1'`, `GROQ_CHAT_MODEL='llama-3.3-70b-versatile'`, `GROQ_WHISPER_MODEL='whisper-large-v3'`, and a `groqChatJSON(prompt, {system?, temperature?})` helper. Refactor `voiceParse.ts`, `generate-materials`, `generate-news` to import from it.
4. **generate-news bug:** it uses model **`qwen/qwen3.8-27b`** which is not a valid Groq production model → API error even with a key. Switch to `GROQ_CHAT_MODEL` (`llama-3.3-70b-versatile`).
5. **Fallback honesty:** the current catch blocks return `success:true` with a fake row whose name embeds the raw error (`"...(Error: ...)"`). Instead return `{ success:false, error }` (or an empty `data:[]` with a real error field) so the UI can show a clean "couldn't load, retry" state — never surface raw error text as a fake material/news item. Update `src/app/artisan/materials/page.tsx` and `src/app/artisan/news/page.tsx` to render a proper empty/error state + retry.
6. After the fix, verify: record audio in the Capture modal → transcription returns; open Raw Materials and Live News tabs → real content loads. If `GROQ_API_KEY` is genuinely unset at runtime, the UI must say "AI service not configured" rather than throwing.

---

## 2. ISSUE #1 — Learn & Grow AI shows unrelated YouTube videos

**File:** `src/app/api/artisan/chat/route.ts` (+ `src/components/LearningAssistantModal.tsx`).

**Diagnosis:** the route scrapes `youtube.com/results` HTML and regex-grabs **any** `"videoId":"…"` — which includes promoted/sidebar/mix entries — then picks the first embeddable one. Result: often unrelated to the query. Also `LearningAssistantModal` hardcodes `craftType: 'Pattachitra'` for every artisan, so the query itself is wrong for non-Pattachitra users.

**Fix:**
1. **Use the real craft.** In `LearningAssistantModal`, stop hardcoding `'Pattachitra'`. Fetch the artisan's `craftType` (from `/api/artisan/dashboard` or pass it in as a prop from the dashboard page which already has `dashboardData.artisanProfile.craftType`) and send that.
2. **Relevance-first video pick.** Prefer the **YouTube Data API v3** if a key is available: add optional `YOUTUBE_API_KEY` to `.env`/`.env.example`; when set, call `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=5&q=<query>` and take the **first result** (already relevance-ranked), then confirm embeddability via oEmbed. This is the correct fix.
3. **If no API key,** keep scraping but extract only genuine search results, not stray ids: parse the `ytInitialData` JSON blob (`var ytInitialData = {…};`) and read `contents…itemSectionRenderer…videoRenderer.videoId` in order, skipping `promotedVideo`/`compactVideoRenderer`/shelf items. Take the **first** such result whose oEmbed is OK. Do **not** sort by view count (`sp=CAM…`) — that's what surfaces big unrelated videos; relevance order is what the artisan wants.
4. Make the model return a tighter `youtubeQuery` (append the craft type + "tutorial"/"how to"). Keep the existing JSON-schema response.
5. If no relevant embeddable video is found, return `videoId: null` and have the modal show a "Search on YouTube" deep link instead of a random embed.
6. Respect the chosen language (see §6): pass `language` and instruct the model to reply in it.

---

## 3. ISSUES #3 & #4 — Audio errors
Primarily fixed by **§1** (Groq key). Additionally harden `src/components/CaptureModal.tsx` `processAudioWithGroq` and `src/app/api/items/voice-parse/route.ts`:
- When `transcribeAudio` returns null because the key is missing, `voice-parse` should return a clear `{ error: "Voice AI not configured" }` (400/503) so the modal banner is specific, and the **typed** description path still works (it already does).
- Guard empty/too-short recordings (`audioBlob.size` below a few KB) with a friendly "recording too short" banner instead of a failed API call.
- Confirm the Whisper request sends the blob as `recording.webm` with the correct mime (it does). Keep the in-app banner (no browser `alert`).

---

## 4. ISSUE #7 — Landing "For Admins" should open the Admin tab on the login page

**Files:** `src/app/page.tsx`, `src/app/login/page.tsx`.
- In `page.tsx`, change the "For Admins" links (nav + hero) from `/login` to **`/login?role=admin`**. Leave "For Artisans" as `/login` (or `/login?role=artisan`).
- In `login/page.tsx`, on mount read `window.location.search` (deferred `useEffect`, per the Next-16 note) and if `role=admin` call `setRole('ADMIN')` so the Admin tab is preselected. Keep the existing role-mismatch guard.

---

## 5. ISSUE #5 — Language change must work across ALL tabs and persist on navigation

**File:** `src/lib/translations.ts` (`useLanguage`) + every user-facing page.

**Diagnosis:** `useLanguage()` is a plain hook (per-component `useState`), but it already broadcasts a `language-change` `CustomEvent` and re-reads `localStorage('karigari_lang')` on mount, so in-document sync mostly works. The real gaps: (a) **landing page and login page use hardcoded English**, never `t()`, so language changes never affect them; (b) some pages/components have hardcoded strings; (c) the login language `<select>` writes `localStorage` directly **without** dispatching `language-change`, so other mounted components don't update.

**Fix:**
1. **Harden the hook** (keep the CustomEvent approach, it's fine): also listen to the native `storage` event so a change in one browser tab syncs others; guard `localStorage` access in try/catch (Next 16 SSR safety). Keep `changeLanguage` writing localStorage + dispatching the event.
2. **Login `<select>`:** call `changeLanguage(value)` from `useLanguage()` instead of writing `localStorage` directly, so the event fires.
3. **Wire every tab to `t()`** with dictionary keys — audit and convert hardcoded strings on: `src/app/page.tsx` (landing), `src/app/login/page.tsx`, `src/app/register/page.tsx`, and confirm coverage on `artisan/dashboard`, `artisan/market`, `artisan/insights`, `artisan/materials`, `artisan/news`, `artisan/schemes`, `buyer`, `marketplace/page.tsx`, `marketplace/product/[id]/ProductClient.tsx`, `verify/[patchId]`. Add any missing keys to the `dictionary` in `translations.ts` for **all four** languages (`en`, `hi`, `or`, `te`) — never leave a key present in only one language (the `t()` fallback already degrades to English, but fill them for real). Add a compact **language switcher** (reuse the dashboard's 4-button menu pattern) to the landing nav and the marketplace header so a visitor can switch before logging in.
4. Verify: switch language on the dashboard → header, cards, table headers all change; navigate to Market/Insights/News/Materials → still in the chosen language; reload → still persisted; switch on landing → hero + nav change.

---

## 6. ISSUE #6 — The AI must speak and understand the user's chosen language

Thread the current `language` (from `useLanguage()`) into every AI request and instruct the model to **respond in that language** and to **understand input written/spoken in it**:
- `POST /api/artisan/chat` — add `language`; system/user prompt: "Reply in {languageName}. The user may write in {languageName}, Hindi, Odia, Telugu, or English — understand any of them." Keep the JSON schema; the `reply` field comes back localized.
- `generate-materials`, `generate-news` — add `language`; ask the model to return `name`/`description`/`title` fields in that language (news links stay as-is). Live-news summaries already come from real RSS — translate the summary into the chosen language, do not invent news.
- `voice-parse` / `voiceParse.ts` — already detects Odia/Hindi/Telugu input; also honor an explicit `targetLanguage` for the English/local description fields.
- `items/vision-verify` already takes `targetLanguage` — keep passing the live `language`.
- Map codes → names once (`en→English, hi→Hindi, or→Odia, te→Telugu`) in `src/lib/groq.ts` or `translations.ts` and reuse. Keep it honest: the model translates/answers; it must not fabricate facts.

---

## 7. ISSUE #8 — Remove "Verify Authenticity" button from the digital passport (marketplace product)

**Files:** `src/app/verify/[patchId]/VerificationClient.tsx` (renders `<VerificationCamera>` ≈ lines 103–105), `src/components/VerificationCamera.tsx`.
- Remove the interactive "Verify Authenticity" camera block from the passport view reached via **"View the digital passport"** on `marketplace/product/[id]/ProductClient.tsx`. Keep the rest of the passport (provenance, timeline, artisan bio).
- The passport's authenticity guarantee now comes from the QR patch + the sellable-time AI match (§9); optionally replace the removed block with a short "Scan the QR patch on the product to verify" note that links to the buyer-scan flow (§9). Do not leave a dangling import — drop `VerificationCamera` from this page if unused.

---

## 8. ISSUE #10 — Make "List on ONDC" a standalone button in Insights (out of the AI recommendation card)

**File:** `src/app/artisan/insights/page.tsx` (the `<Link href="/artisan/market">…{t("list_on_ondc")}</Link>` currently sits inside the AI-recommendation `<section>`, ≈ line 385).
- Remove that link from inside the AI recommendation card.
- Add a **new standalone `<section>`** styled exactly like the "Government catalog export" section directly below it (card, title, right-aligned CTA button) with its own **"List on ONDC"** button. It links to the Market page's Syndication Hub tab (see the market page) — e.g. `/artisan/market?tab=syndication` (add support in `market/page.tsx` to preselect that tab from the query param, per the Next-16 query-read pattern).

---

## 9. ISSUE #12 — Move "Buyer view" to the landing page; remove it from the artisan dashboard

**Files:** `src/app/page.tsx`, `src/app/artisan/dashboard/page.tsx` (≈ line 140 `Switch to Buyer View`).
- In `page.tsx` nav, change the **"How it Works"** link text to **"Buyer"** and set its `href="/buyer"` (translate the label via `t()`).
- In `artisan/dashboard/page.tsx`, **delete** the `Switch to Buyer View` `<Link href="/buyer">` entirely from the header.

---

## 10. ISSUE #11 — "List on ONDC" action in the captures table (only when sellable)

**File:** `src/app/artisan/dashboard/page.tsx` — the "Manage & track your recent craft captures" table (the `recentCaptures.map(...)` rows, action column ≈ lines 460–475).
- Add, on the **left side of the Action cell** for every row, a **"List on ONDC"** button.
- Behavior: if `item.status === 'SELLABLE'` (new status from §11) → `POST /api/artisan/syndicate` with `{ craftItemId: item.id, targetPlatforms: ['KARIGARI_ONDC','ONDC_PAYTM_MAGICPIN'] }` (reuse the existing route created earlier — it sets `isListedOnMarketplace=true, isOndcLive=true` and logs `MULTI_CHANNEL_SYNDICATE`), then refresh the table and show a success chip. If **not** sellable → show a screen alert/toast: "This item must be verified and QR-confirmed (Sellable) before it can be listed on ONDC." (Prefer an in-app banner/toast over `window.alert`, consistent with the app.)
- Keep the existing "View Details"/"Complete Draft" actions. Widen the row/action layout so both fit on mobile (stack or wrap).

---

## 11. ISSUE #9 — QR patch on approval → artisan re-uploads QR'd product photo → AI verifies → Sellable → buyer can scan to verify

This is the biggest change. It reworks the approval → listing lifecycle. Implement carefully.

### 11.1 Status lifecycle (make it explicit)
`PENDING_VERIFICATION` → (admin approves) **`VERIFIED`** (patchId + QR generated, **not yet listed**) → (artisan uploads QR'd photo, AI confirms) **`SELLABLE`** → (artisan clicks List on ONDC, §10) listed (`isListedOnMarketplace/isOndcLive`) → sold via escrow. Add `SELLABLE` to the status vocabulary used across dashboard/admin.

### 11.2 Schema (`prisma/schema.prisma`, `CraftItem`)
Add:
```prisma
qrVerified          Boolean  @default(false)   // true once the re-uploaded QR photo passes AI match
qrVerifiedImageUrl  String?                     // the artisan's photo of the physical product WITH the QR patch
qrVerifiedAt        DateTime?
```
`patchId` already exists (generated at approval). Run `npx prisma generate` (+ `db push` if a live DB).

### 11.3 Admin approval change (`src/app/api/admin/verify-batch/route.ts`)
- Keep generating the unique `patchId` (`PATCH-…`) and setting `status: 'VERIFIED'`, assigning admin, decrementing the patch bank, and the audit logs.
- **STOP auto-publishing:** remove `isListedOnMarketplace: true` from the approval update (and the immediate `MARKETPLACE_PUBLISHED` log). Publication now happens only after `SELLABLE` + the artisan's List-on-ONDC action (§10). The QR (encoding the `patchId`) is what the artisan must physically attach next.

### 11.4 QR generation & download (artisan side)
- The QR encodes a verify URL: `${PUBLIC_BASE_URL||origin}/verify/${patchId}` (so a buyer scan lands on the passport). Render it with the already-installed **`react-qr-code`** (used in `AgentHandoffModal.tsx`).
- In the dashboard captures table, when `status === 'VERIFIED'` and `!qrVerified`, the Action cell shows **"Download QR & Upload Photo"** opening a new modal `src/components/QrAttachModal.tsx` that: (a) shows the QR for `patchId` with a Download button (render QR to canvas/SVG → PNG download; the artisan prints/sticks it on the product), and (b) lets them upload/capture a photo of the **same product with the QR patch visible**, then submits it for AI verification.

### 11.5 AI verification route (`src/app/api/items/attach-verify/route.ts`)
`POST` (artisan-auth, ownership-checked). Body `{ craftItemId, imageBase64 }`. Two real checks:
1. **QR decode must equal the item's `patchId`.** Add `jsqr` (`npm i jsqr`); use the installed `sharp` to decode the uploaded image to raw RGBA (`sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true})`) then `jsQR(data, width, height)`. The decoded text must contain the item's `patchId` (accept the full verify URL or the bare id). If no QR or wrong id → reject with a clear reason.
2. **Same-product match.** Reuse the Gemini vision path (`generateContentWithFallback`, same model order as `items/vision-verify`): send the **original captured image** (`item.images[0]`) and the **new** image and ask the model to confirm they show the **same craft item** (same saree/pattern/colour), not merely the same category. Return `isSameItem` + reasoning. Be moderately strict (this is the anti-fraud gate) but tolerant of lighting/angle.
- On BOTH passing: set `status:'SELLABLE'`, `qrVerified:true`, `qrVerifiedImageUrl`, `qrVerifiedAt`, and log `logCraftItemEvent({ action:'QR_PATCH_VERIFIED', actorId:userId, actorRole:'ARTISAN', comments:'Physical QR patch + product image AI-matched to original; item is now sellable.' })`. Return `{ success:true, status:'SELLABLE' }`.
- On failure: return `{ success:false, reason }`, no status change. The modal shows the reason and lets them retry.

### 11.6 Buyer-scan verification (the "later, when a buyer buys" part)
- The QR already points at `/verify/${patchId}`. On that passport page, since the item now carries `qrVerified`, show a green **"Authenticity confirmed — QR patch matched to the original craft"** badge (replaces the removed camera from §7). Optionally add a lightweight buyer camera that scans the QR client-side and confirms it resolves to this `patchId` (can reuse `jsqr` client-side), but the core requirement is that scanning the product QR reaches the verified passport for this exact item.
- Persist nothing new for the buyer scan beyond reading the row; keep it honest ("QR patch verified at source").

### 11.7 Dashboard status chips
Update the status → color/label map (dashboard table ≈ line 425 and `describeArtisanMoney`) to include `VERIFIED` (awaiting QR upload — amber/mint) and `SELLABLE` (ready to list — green). Add `sellable`/`verified` keys to the dictionary (all 4 languages).

---

## 12. ISSUE #13 — Draft (Capture) modal upgrades

**File:** `src/components/CaptureModal.tsx` (Step 2 upload ≈ 633–784, vision effect ≈ 98–146; Step 3 price ≈ 785–858).

### 13.1 Real background removal + enhancement BEFORE vision verification
Currently the "enhancement" is a fake 2-second `setTimeout` before calling `/api/items/vision-verify`. Make it real:
- Add **`@imgly/background-removal`** (`npm i @imgly/background-removal`) — client-side, WASM/ONNX, **no API key**. On image upload, before vision-verify: run `removeBackground(blob)` to get a clean cutout on a neutral/white background, then apply a light enhancement pass on a `<canvas>` (normalize brightness/contrast, mild sharpen) and use the enhanced data URL as the image that gets vision-verified and saved.
- Make it non-blocking and resilient: show an "Enhancing image…" state; if bg-removal fails or is slow (>~6s) fall back to the enhanced original so capture never stalls. (Optional server alternative with the installed `sharp` for the enhancement step — but bg-removal needs the ML lib.) Keep the honest UX: the artisan sees the before/after.
- The enhanced/cutout image is what proceeds to `/api/items/vision-verify` and into `images[]` on save.

### 13.2 Step 3 "Dynamic Pricing Assistant" — comparable prices across platforms
Add, in Step 3 (next to the existing AI valuation), a **Dynamic Pricing Assistant** that finds comparable items and their prices on Amazon/Flipkart/Myntra etc. and recommends a price.
- New route `src/app/api/items/price-research/route.ts` (`POST { craftType, description, valuation }`). Return `{ recommendedPrice, comparables: [{ platform, title, priceMin, priceMax, note }] }`.
- **Sourcing & honesty (important):** do **not** scrape or fabricate specific real Amazon/Flipkart listings and present them as live scraped rows (unreliable + misleading). Instead use the AI (Groq via `src/lib/groq.ts`, or Gemini) grounded in the craft valuation to produce **estimated comparable price ranges per platform** for that craft category, clearly labeled "estimated market comparables". If a `YOUTUBE_API_KEY`-style real product-search API is available, wire it; otherwise keep the AI estimate. The recommended price should be reconciled with `estimateCraftValuation`'s band and the fair-wage floor (never recommend below the floor).
- **UI:** render the comparables in their **own sub-panel/tab within Step 3** titled "Similar items found across platforms", each row = platform + price range; show the **recommended price** with a "Use this price" button that fills `askingPrice`. Match the images the user referenced (a comparison list + a recommended figure). Keep the existing manual price field and the below-floor warning.
- Pass `language` (§6) so labels/notes localize.

---

## 13. VERIFICATION CHECKLIST (do all)
1. `npm install` the new deps: `jsqr`, `@imgly/background-removal` (and confirm `sharp`, `react-qr-code` already present). `npx prisma generate`.
2. **§1 smoke test:** with `GROQ_API_KEY` set, audio transcribes, Raw Materials + Live News load real content; with it unset, UIs show a clean "not configured" state (no thrown errors, no fake rows).
3. **#1:** Learn & Grow returns a video that matches the asked topic for a non-Pattachitra craft; unrelated-video case returns a search link, not a random embed.
4. **#7:** landing "For Admins" opens login with the Admin tab active.
5. **#5/#6:** switching language changes landing, login, dashboard, and all artisan tabs, persists across navigation and reload; AI replies come back in the chosen language.
6. **#8:** no "Verify Authenticity" camera on the marketplace digital passport.
7. **#10:** standalone "List on ONDC" section in Insights; the AI-recommendation card no longer contains it.
8. **#12:** dashboard has no "Switch to Buyer View"; landing "How it Works" is now "Buyer" → `/buyer`.
9. **#11 (#9):** approve a draft → `VERIFIED` + QR (patchId) shown, not auto-listed; download QR, upload a photo with the QR → wrong QR or different product is rejected, correct match flips it to `SELLABLE`; only then does "List on ONDC" (captures table) publish it; a non-sellable item shows the alert; scanning the QR reaches the verified passport.
10. **#13:** uploading a photo in Capture removes background + enhances before verification; Step 3 shows comparable-platform prices + a recommended price with "Use this price".
11. `npm run build` green; strict TS; theme + responsive intact; latency acceptable (no synchronous blocking on the ML bg-removal — it degrades gracefully).
12. End with a summary: files created/edited, schema fields added, new env vars (`GROQ_API_KEY` rename, optional `YOUTUBE_API_KEY`), new deps, and the exact commands run.

---

### FILE MAP
**Env:** `.env`, `.env.example` (rename `GROK_KEY`→`GROQ_API_KEY`; optional `YOUTUBE_API_KEY`).
**Create:** `src/lib/groq.ts`, `src/app/api/items/attach-verify/route.ts`, `src/app/api/items/price-research/route.ts`, `src/components/QrAttachModal.tsx`.
**Edit (APIs):** `src/lib/voiceParse.ts`, `src/app/api/artisan/generate-materials/route.ts`, `src/app/api/artisan/generate-news/route.ts`, `src/app/api/artisan/chat/route.ts`, `src/app/api/items/voice-parse/route.ts`, `src/app/api/items/vision-verify/route.ts`, `src/app/api/admin/verify-batch/route.ts`, `src/app/api/artisan/insights/route.ts`.
**Edit (pages/components):** `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/artisan/dashboard/page.tsx`, `src/app/artisan/market/page.tsx`, `src/app/artisan/insights/page.tsx`, `src/app/artisan/materials/page.tsx`, `src/app/artisan/news/page.tsx`, `src/components/CaptureModal.tsx`, `src/components/LearningAssistantModal.tsx`, `src/app/verify/[patchId]/VerificationClient.tsx`, `src/app/marketplace/product/[id]/ProductClient.tsx`, `src/lib/translations.ts`, `prisma/schema.prisma`.
**Reuse:** `@/lib/prisma`, `@/lib/auditLogger`, `@/lib/pricing`, `@/lib/gemini`, `requireArtisan()` pattern, `react-qr-code`, `sharp`.
