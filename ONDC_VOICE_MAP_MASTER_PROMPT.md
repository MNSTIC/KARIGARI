# MASTER PROMPT — KARIGARI: Voice Fix · Real ONDC Beckn Adapter · Real Location Map · Full QA

> Paste this whole file into Claude Code. Four items, each mapped to exact files. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there; `npm install`; after any `prisma generate`, restart `npm run dev`). Match the theme in `src/app/globals.css` (primary `#24332C`, background `#FCF8F7`, mint `#DCEBE0`); keep `useLanguage` i18n; Next 16 rules (`await cookies()`, `await params`). Auth = JWT cookie `auth-token`, payload `{ userId, role }`.

---

## ITEM 1 — Voice assistant returns "Sorry, I could not hear that clearly"

### Root cause (diagnosed, not guessed)
That sentence is the **server-side fallback** in `src/app/api/voice-assistant/route.ts` (`FALLBACK_REPLY`, lines 38–44), returned from the `catch` block (lines 239–252) whenever the Gemini call throws. It is **not** a microphone problem — the browser recorded audio and posted it; Gemini rejected it.
- The Gemini call runs through `generateContentWithFallback` (`src/lib/gemini.ts`). That helper only advances to the next model on 503/404/429; a **401/403 invalid-key** error throws immediately → the route's catch → the fallback reply.
- **`.env` `GEMINI_API_KEY` is the wrong format.** A valid Google AI Studio key starts with **`AIza…`**. The current value starts with `AQ.` (an OAuth/ephemeral-token shape), which the `@google/genai` client cannot use as an API key — so every Gemini call 401s. This also silently degrades the insights AI and capture parsing (they have rule-based fallbacks, so only voice shows it outright).

### Human action required (Claude Code cannot do this)
Replace `GEMINI_API_KEY` in `KARIGARI-main/KARIGARI/.env` with a real AI Studio key (`AIza…`) from https://aistudio.google.com/apikey, then restart `npm run dev`. **The voice assistant cannot work until this key is valid.**

### What Claude Code must change (so failures are honest and self-diagnosing)
1. **Distinguish "AI not configured" from "couldn't hear you."** In `voice-assistant/route.ts`, before calling Gemini, validate the key: if `GEMINI_API_KEY` is missing or doesn't look like a valid key (e.g. doesn't start with `AIza`), return a distinct, honest payload (e.g. `reply: "The voice assistant isn't configured yet. Ask the team to add a Gemini API key."`, `engine: 'unconfigured'`) instead of the generic "could not hear" line. Do the same when the caught error is an auth error (status 400/401/403 / `API_KEY_INVALID`).
2. **Surface the real error while developing.** Enhance the `catch` log to include `error?.status` and `error?.message` (and, in `generateContentWithFallback`, log the model + status per failure) so the terminal shows the true cause (invalid key vs 404 model vs audio rejected).
3. **Guarantee a valid model in the fallback list.** `VOICE_MODELS` (line 19) and `FALLBACK_MODELS` (`gemini.ts` line 11) use `gemini-3.7-flash` / `gemini-3.5-flash`. `gemini-3.5-flash` is a real model; `gemini-3.7-flash` may 404 on some keys/tiers. Append a definitely-available fallback (e.g. `gemini-flash-latest` or `gemini-2.5-flash`) to the END of both lists so a 404 on the newer names still lands on a working model. Verify the chosen names against the account (a quick `ai.models.list()` or the Gemini docs) and keep the ones that resolve.
4. **Confirm the client audio path is fine** (it is, but verify): `src/components/VoiceOnboarding.tsx` records via `MediaRecorder`, base64-encodes, and POSTs `{ audio, mimeType, language }`. Keep the existing "empty blob → say nothing" guard, and make sure a `degraded`/`unconfigured` response is shown to the user as a clear message, not spoken as if it were a real answer.

### Item 1 acceptance
With a valid `AIza…` key: speaking into the assistant returns a real transcript + spoken reply in the chosen language. With a missing/invalid key: the UI clearly says the assistant isn't configured (not "I couldn't hear you"), and the server log names the exact Gemini error.

---

## ITEM 2 — Real ONDC "Beckn" Provider Adapter (not a mock)

Build a **Beckn Protocol JSON adapter**: an API route that emits the KARIGARI `CraftItem` rows in the exact `on_search` catalog shape ONDC buyer apps consume. You are NOT joining the live ONDC network — you are exposing a spec-correct **Provider (BPP) catalog** endpoint.

### New route: `src/app/api/ondc/catalog/route.ts` (public GET)
- Query the DB for **published** items only: `prisma.craftItem.findMany({ where: { isListedOnMarketplace: true /* or patchId not null */ }, include: { artisan: { include: { artisanProfile: true } } } })`.
- Group items by artisan → each artisan becomes a **provider**. Map to the Beckn `on_search` catalog. Use `descriptionEnglish`/`aiGeneratedListing` as the item description (the English ONDC listing), `images[]`, price from `salePrice ?? standardMarketPrice ?? fairWageFloor`, `patchId` as a tag, `craftType`/`aiSuggestedCategory` as category, `artisanProfile.location` as the provider location.
- Return this structure (ONDC RET1x, Beckn core 1.2.0 — verify field names against the official spec, links below):

```jsonc
{
  "context": {
    "domain": "ONDC:RET1B",            // handicrafts/handlooms
    "action": "on_search",
    "country": "IND",
    "city": "std:080",
    "core_version": "1.2.0",
    "bpp_id": "karigari.example.com",   // your provider node id
    "bpp_uri": "https://karigari.example.com/api/ondc",
    "transaction_id": "<uuid>",
    "message_id": "<uuid>",
    "timestamp": "<ISO8601>"
  },
  "message": {
    "catalog": {
      "bpp/descriptor": { "name": "KARIGARI", "short_desc": "AI-verified artisan crafts", "images": [] },
      "bpp/providers": [
        {
          "id": "<artisan userId>",
          "descriptor": { "name": "<artisan name>", "short_desc": "<cluster / craft>", "images": [] },
          "locations": [ { "id": "L1", "gps": "<lat,lon>", "address": { "city": "<location>", "state": "<state>" } } ],
          "categories": [ { "id": "<craftType-slug>", "descriptor": { "name": "<craftType>" } } ],
          "items": [
            {
              "id": "<craftItem id>",
              "descriptor": {
                "name": "<craftType>",
                "code": "<patchId>",
                "short_desc": "<descriptionEnglish>",
                "long_desc": "<aiGeneratedListing>",
                "images": ["<image urls>"]
              },
              "price": { "currency": "INR", "value": "<price as string>" },
              "category_id": "<craftType-slug>",
              "location_id": "L1",
              "fulfillment_id": "F1",
              "@ondc/org/returnable": false,
              "@ondc/org/cancellable": true,
              "@ondc/org/available_on_cod": false,
              "@ondc/org/time_to_ship": "P7D",
              "@ondc/org/seller_pickup_return": false,
              "tags": [
                { "code": "origin", "list": [ { "code": "country", "value": "IND" } ] },
                { "code": "attribute", "list": [ { "code": "patch_id", "value": "<patchId>" }, { "code": "fair_wage_floor", "value": "<fairWageFloor>" } ] }
              ]
            }
          ],
          "fulfillments": [ { "id": "F1", "type": "Delivery" } ]
        }
      ]
    }
  }
}
```
- Generate `context.transaction_id`/`message_id` as UUIDs and `timestamp` as `new Date().toISOString()`. Resolve `gps` from `src/lib/indiaGeo.ts` `locateCity(location)` (`"<lat>,<lon>"`); omit gps if unresolved rather than inventing one.
- Keep it a **pure serializer** — no auth needed (a real BPP catalog is public), `export const dynamic = 'force-dynamic'`.

### Wire it into the UI (`src/app/artisan/market/page.tsx`, the ONDC tab ~line 421)
The ONDC tab is currently pitch text. Add a real, honest panel: a **"View ONDC Provider Catalog (Beckn JSON)"** button/link that opens `/api/ondc/catalog` in a new tab (or renders the live JSON inline in a `<pre>`), a short line of how many items are being broadcast, and the pitch copy: *"KARIGARI is an ONDC Provider Node — the moment the AI verifies a product it is exposed in Beckn `on_search` format for any ONDC buyer app (Paytm, Mystore, …) to ingest."* Do not claim items are live on the real ONDC network; claim they are **broadcast-ready in Beckn format** via this node.

### Item 2 acceptance
`GET /api/ondc/catalog` returns valid Beckn `on_search` JSON containing exactly the published `CraftItem`s grouped by artisan-provider, with real prices/descriptions/images and gps where resolvable. The market ONDC tab links to it and shows the live item count. Validate the shape against the ONDC/Beckn spec.
Spec references: https://github.com/beckn/protocol-specifications and https://github.com/ONDC-Official (retail `on_search`).

---

## ITEM 3 — Demand map: pin the artisan's REAL profile location

### Current state (the previous fix partly shipped)
`src/app/artisan/insights/page.tsx` **already** imports `locateCity, toMapPercent, distanceKm, MAP_BBOX` (line 17), computes `myLocationPoint = locateCity(insights?.profileLocation)` (line 164), renders a "Your location" pin (lines 288–301), and sorts demands by distance (lines 569–577). So the home-pin logic exists. **The real problem is the data:** the test artisan's profile `location` is a placeholder like "Local Cluster"/"Unknown" (your dashboard shows "Local Cluster · Artisan"), which `locateCity` can't resolve → `myLocationPoint` is null → no home pin, and the map shows only seeded demand pins at random metros.

### What to change
1. **Capture a real, resolvable location at registration and profile edit.** In `src/app/register/page.tsx` and `src/components/ProfileEditorModal.tsx`, make **location** a required, searchable **select of known cities** — the keys of `CITY_COORDS` in `src/lib/indiaGeo.ts` (Pochampally, Bhubaneswar, Sambalpur, Jaipur, Varanasi, …). Save it to `ArtisanProfile.location`. This guarantees every artisan's location resolves on the map. (Keep free-text as a fallback but default to the select.)
2. **Backfill the demo artisan.** In `prisma/seed.ts`, give the seeded artisan(s) a **real** `location` (e.g. "Pochampally") — never "Local Cluster"/"Unknown" — so the home pin renders immediately.
3. **Center the map on the artisan.** When `myLocationPoint` resolves, build the OSM iframe `bbox` around it (and pass the same bbox to `toMapPercent(point, bbox)` — the projection must use the SAME bbox the iframe uses, or pins drift). The home pin should sit near center.
4. **Compute demand data relative to the artisan** (mostly done — verify): demand pins come from real `Demand` rows via `/api/demand`; label each by `distanceKm` from the artisan and sort nearest-first; show the artisan's own supply (their listed `CraftItem` count for that craft) near the home pin. No hardcoded pins or invented numbers.
5. **Extend the gazetteer + graceful fallback.** Add any craft-cluster towns still missing from `CITY_COORDS`. If an artisan's location genuinely can't resolve, show the existing "unmapped/complete your profile" banner with an "Edit profile" action — never drop a pin at a guessed spot.

### Item 3 acceptance
The Live Demand Map shows a distinct **"Your location"** pin at the artisan's real profile city, map centered on it; demand pins are real, distance-labeled, nearest-first; changing the profile city moves the home pin and re-sorts demand. No random/hardcoded pins remain.

---

## ITEM 4 — Full error/warning sweep + feature test

1. Build & types:
```bash
npx tsc --noEmit
npm run build
npm run lint
```
Fix every **TypeScript error and build error**, and any lint warning in files you touch. (A repo-wide lint backlog pre-exists — don't add to it; clean what you edit.)
2. **Runtime smoke-test each feature** with `npm run dev`, logged in with the correct role, and fix what's broken:
   - Auth: login as artisan and as admin; role guards redirect correctly (artisan pages 403-safe).
   - Artisan: dashboard, capture (voice→vision→save, editable bilingual description, in-app not `alert()` errors), insights (WhatsApp sim, demand map home pin, AI card), schemes (loads, apply modal + auto-fill), market (listings + new listing + ONDC catalog link), voice assistant.
   - Buyer: post demand → appears on the insights map → notifies matched artisan (bell).
   - Admin: facilitator (pricing queue, Voice QA auto-publish), nodal (analytics, global audit).
   - Passport: `/verify/[patchId]` shows story + timeline.
   - New: `/api/ondc/catalog` returns valid Beckn JSON.
3. Watch the **browser console and the dev-server terminal**; resolve runtime errors (unhandled promise rejections, missing keys, hydration warnings) in the flows above.

### Item 4 acceptance
`tsc`, `build`, and `lint` (touched files) are clean; every feature above works end-to-end or its breakage is fixed; no uncaught console/server errors in the tested flows.

---

## GLOBAL GUARDRAILS
- Don't weaken auth checks; fix data/config/handling instead.
- No hardcoded map pins, no invented ONDC data — serialize real DB rows.
- Be honest in copy: voice needs a real key; ONDC catalog is Beckn-format broadcast-ready, not a live network sale.
- Keep theme tokens + `useLanguage`; every new string translatable.
- Report changed/new files, the seed change, and confirm which Gemini model names resolved on the account.

## SECURITY NOTE (tell the user)
`.env` currently holds a live DB password and JWT secret in plaintext, and the Gemini key is the wrong type. Since this folder is shared, rotate the Supabase DB password and `JWT_SECRET`, and use a fresh restricted `AIza…` Gemini key. Do not commit `.env` (confirm it's in `.gitignore`).
