# MASTER PROMPT — KARIGARI Toll-Free AI IVR (Twilio) → voice-created draft in the artisan dashboard

> Paste into Claude Code. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there). Next.js 16 App Router, React 19, TypeScript, Prisma 7 (Postgres, driver adapter). Theme in `src/app/globals.css` (primary `#24332C`, mint `#DCEBE0`); keep `useLanguage` i18n.

## 0. Goal
Build a **Toll-Free AI IVR**: an artisan calls the Twilio number, the AI greets them, asks their **name**, matches it to their existing KARIGARI account, then asks them to **describe the craft by voice**. The system transcribes the call, structures it into a **dummy/incomplete draft `CraftItem`** stored under that artisan's account, and shows it in the dashboard's **"My Uploaded Works"** list. Later the artisan logs in, opens the draft, and **completes it by adding image(s) + price** — which moves it into the normal `PENDING_VERIFICATION` flow to the admin.

This uses the **free Twilio trial (US number)** purely as a working demo of the pipeline. Keep the code **provider-agnostic** where reasonable so a real Indian 1800 line can replace the number later.

---

## 1. Twilio prerequisites & `.env`
The user has a Twilio Account SID, Auth Token, plus API-key/client identifiers. For **inbound IVR** you only need the Account SID (for reference), the **Auth Token** (to validate webhook signatures), and the trial **phone number**. Add to `KARIGARI-main/KARIGARI/.env` (this file is gitignored — never commit real secrets):
```
TWILIO_ACCOUNT_SID=AC_xxx          # the Account SID (AC...)
TWILIO_AUTH_TOKEN=xxx              # the PRIMARY auth token — used for X-Twilio-Signature validation
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx   # the trial US number
PUBLIC_BASE_URL=https://<your-ngrok-subdomain>.ngrok-free.app   # the tunnel to localhost:3000 (see §6)
# Optional, ONLY if a browser Voice SDK is added later — NOT needed for this inbound IVR:
# TWILIO_API_KEY_SID=SK_xxx
# TWILIO_API_KEY_SECRET=xxx
# TWILIO_TWIML_APP_SID=AP_xxx
```
Install the SDK (for TwiML building + signature validation): `npm i twilio`.

---

## 2. Data model (`prisma/schema.prisma`, `CraftItem`)
`status` is a plain `String`, so **no enum/migration is needed** to add a new state — use the string **`"IVR_DRAFT"`** for these voice-created drafts. The transcript is stored in the existing `descriptionOriginal`. Optionally add one traceability column:
```prisma
ivrCallSid String?   // Twilio CallSid that created this draft; null for app-created items
```
If you add it, run `npx prisma db push && npx prisma generate` and **restart the dev server**. (Skip if you prefer zero migration — it's optional.)

A draft `CraftItem` is created with: `status: "IVR_DRAFT"`, `catalogMethod: "IVR"`, `descriptionOriginal` = the call transcript, `descriptionEnglish`/`craftType`/`laborDays`/`rawMaterialCost` from parsing, `images: []`, `askingPrice: null`. It is deliberately **incomplete** (no image, no price) until the artisan finishes it.

---

## 3. The IVR webhooks (Twilio Programmable Voice, TwiML)
⚠️ **Twilio posts `application/x-www-form-urlencoded`, not JSON.** Every handler must read params with `await req.formData()` (fields like `From`, `To`, `CallSid`, `SpeechResult`, `Confidence`), and **respond with `Content-Type: text/xml`** containing TwiML. Twilio is stateless per request — pass state (matched `artisanId`, `name`) between steps via the `action` URL query string. Build TwiML with the `twilio` SDK (`twiml.VoiceResponse`).

Create three routes:

**`POST /api/ivr/voice`** — entry point (this is the URL you set on the number in the Twilio console):
- `<Say voice="Polly.Aditi" language="en-IN">` (or default) : *"Welcome to the KARIGARI artisan helpline. After the beep, please say your name."*
- `<Gather input="speech" language="en-IN" speechTimeout="auto" action="${PUBLIC_BASE_URL}/api/ivr/collect-name" method="POST">`.
- Add a no-input reprompt/`<Redirect>` fallback.

**`POST /api/ivr/collect-name`** — read `SpeechResult` (the spoken name):
- Match to a `User` where `role = 'ARTISAN'` by name, case-insensitive (`contains`), trimmed. Prefer an exact case-insensitive match, else first `contains` match. **Fallback/robustness:** also try matching the caller's `From` number against `ArtisanProfile.mobileNumber` — if the name is unclear but the phone matches, use that. (Name is the primary key per the spec; phone is a safety net.)
- **No match:** `<Say>` *"We could not find your account by that name. Please try again or visit your local facilitator."* then `<Redirect>` back to `/api/ivr/voice` (allow ~2 tries, then `<Hangup/>`).
- **Match:** `<Say>` *"Thank you {name}. Now, after the beep, describe the craft you have made — what it is, the material, and how many days it took."* then `<Gather input="speech" speechTimeout="auto" action="${PUBLIC_BASE_URL}/api/ivr/collect-item?artisanId=${id}&name=${encodeURIComponent(name)}" method="POST">`.

**`POST /api/ivr/collect-item?artisanId=&name=`** — read `SpeechResult` (the item description transcript):
- Structure it into fields. Reuse the existing parser: call the same Gemini logic as `src/app/api/items/voice-parse/route.ts` (import a shared helper, or call it inline) with `regionalTranscript = SpeechResult`. That returns `{ craftType, englishDescription, originalTranscript, laborDays, rawMaterialCost, sourceLanguage }`, and it already **falls back gracefully** if Gemini is unavailable (the app's Gemini key is currently invalid, so expect the fallback — that's fine; still store the raw `SpeechResult` as `descriptionOriginal`).
- Create the draft `CraftItem`: `artisanId` (from the query), `status: "IVR_DRAFT"`, `catalogMethod: "IVR"`, `descriptionOriginal: SpeechResult`, `descriptionEnglish`, `craftType`, `laborDays`, `rawMaterialCost`, `voiceLanguage: sourceLanguage`, `images: []`, `askingPrice: null`, `ivrCallSid: CallSid` (if you added the column). Write an `AuditLog` via `logCraftItemEvent` (`@/lib/auditLogger`), action `"IVR_DRAFT_CREATED"`, comments summarizing the call.
- `<Say>` *"Thank you. Your craft has been saved as a draft under your account. Please log in to KARIGARI, add a photo and a price, and submit it for verification. Goodbye."* then `<Hangup/>`.

**Security — validate every webhook.** Use the `twilio` SDK's request validation (`twilio.validateRequest(authToken, signature, url, params)`) against the `X-Twilio-Signature` header, the full public URL (`PUBLIC_BASE_URL` + path + query), and the POST params. Reject with 403 if invalid, so nobody can forge drafts by POSTing to your endpoint. (Allow a dev bypass only if `NODE_ENV !== 'production'` AND an explicit `IVR_SKIP_SIGNATURE=true` is set — do not skip by default.)

---

## 4. Dashboard: show the draft & let the artisan complete it
The draft already appears in **"My Uploaded Works"** because `src/app/api/artisan/dashboard/route.ts` returns all of the artisan's items in `recentCaptures`, and `src/app/artisan/dashboard/page.tsx` renders them in the recent-captures table (rows ~312–345, status badge logic ~314–317, action button ~342). Add:
- **A distinct status badge** for `IVR_DRAFT` — e.g. a mint/amber "Voice draft — add photo & price" chip (reuse the existing `statusClass` pattern; add a branch for `IVR_DRAFT`). Localize via `useLanguage`.
- **Action = "Complete draft"** for `IVR_DRAFT` rows (instead of "View Details"): a button that opens a **Complete-Draft modal**.

**Complete-Draft modal** (new component, e.g. `src/components/CompleteDraftModal.tsx`, styled to match `CaptureModal`):
- Shows the transcript / parsed `craftType` + `descriptionEnglish` (editable text is a plus, read-only is acceptable).
- Lets the artisan **add image(s)** (reuse the camera/upload UI from `CaptureModal.tsx`) and **set the asking price** (reuse the price input + AI-suggested band + below-floor warning you built for capture Step 3).
- On submit → `POST /api/items/complete-draft` `{ itemId, images, askingPrice, craftType?, descriptionEnglish? }`.

**`POST /api/items/complete-draft`** (gate `ARTISAN`, verify the item is owned by the caller AND `status === 'IVR_DRAFT'`):
- Save `images`, `askingPrice`, optional edited fields; compute `fairWageFloor` / `standardMarketPrice` / `marketPriceMin/Max` using the **same valuation formula as `src/app/api/items/capture/route.ts`** (lines ~50–73: baseWage by craft, `laborCost = days*baseWage`, `overhead = (laborCost+rawCost)*0.1`, `fairWageFloor = laborCost+rawCost+overhead`, seasonal bump, market bands). **Extract that formula into a shared `src/lib/valuation.ts` and use it in both places** so capture, complete-draft, and IVR stay consistent (DRY).
- Set `pricingFlag`/`flagReason` if `askingPrice < fairWageFloor * 0.7` (same rule as capture).
- Flip `status` to `PENDING_VERIFICATION` (now it enters the normal admin/facilitator flow). Write an `AuditLog` `"DRAFT_COMPLETED"`.
- Return the updated item; the dashboard refetches and the row now shows as Pending Verification.

---

## 5. Guardrails
- Webhooks read `formData()` and return `text/xml` TwiML; **validate `X-Twilio-Signature`**.
- Don't trust query/POST data for ownership — the complete-draft route re-checks the item belongs to the logged-in artisan and is still `IVR_DRAFT`.
- No hardcoded fake data; the draft is real DB data tied to the matched account.
- Keep theme + i18n; secrets only in `.env` (gitignored) — never commit them.
- Reuse existing code (voice-parse, capture valuation, CaptureModal image/price UI) rather than duplicating.

## 6. Run & verify (report results)
1. `npm i twilio`; add the `.env` vars; `npm run dev`.
2. Expose localhost: `npx ngrok http 3000` (or the team's tunnel). Put the HTTPS URL in `PUBLIC_BASE_URL`.
3. In the Twilio Console → your trial number → **Voice → "A call comes in" → Webhook → `https://<ngrok>/api/ivr/voice` (HTTP POST)**. Save.
4. From a **verified** phone (trial requirement), call the Twilio number. Confirm: greeting plays → say your name → it matches your seeded artisan → describe an item → it says the draft is saved → `<Hangup>`.
5. Log in as that artisan → **My Uploaded Works** shows the new **"Voice draft"** row → click **Complete draft** → add an image + price → submit → the row becomes **Pending Verification** and appears in the admin/facilitator queue.
6. Confirm signature validation rejects a forged `curl` POST (no valid signature → 403).
7. `npx tsc --noEmit && npm run build` pass. Report files added/changed and the exact Twilio webhook URL to configure.

## 7. Honesty / limits (keep in the pitch, don't hide)
This runs on a **US trial number**: only **verified** numbers can call it, Twilio plays a "trial account" preamble, and an Indian caller would pay ISD (so it's a working **proof**, not the real toll-free). Present it as: *"The AI IVR pipeline is built and provider-agnostic; it deploys to a real Indian 1800 line once a partner cooperative completes KYC."* For a fully free live demo without the verified-caller limit, the same webhooks can be driven by a browser Voice SDK softphone later — out of scope here.
