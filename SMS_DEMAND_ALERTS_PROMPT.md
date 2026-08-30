# MASTER PROMPT — KARIGARI SMS demand alerts (Twilio) + reply "1" to accept

> Paste into Claude Code. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there). Next 16 App Router, Prisma 7 (Postgres, driver adapter). Keep theme + `useLanguage`. This is the offline-reach feature: when a buyer's demand matches an artisan, the artisan gets a **real SMS**; they reply **`1`** to accept and a webhook records it in the DB — no dashboard needed.

## 0. Goal
1. When a buyer posts a demand and it matches artisans (existing matching already exists), **send those artisans an SMS** via Twilio (to their profile `mobileNumber`): the demand + "Reply 1 to accept."
2. Artisan replies **`1`** (accept) — Twilio POSTs the inbound SMS to a webhook that finds the artisan, marks their latest demand alert **accepted**, updates the DB, and SMS-replies a confirmation. (`2`/`NO` = decline; anything else = short help.)

## 1. FIRST fix two `.env` issues (they will break Twilio before any code runs)
Open `KARIGARI-main/KARIGARI/.env`:
- **`TWILIO_AUTH_TOKEN` has a leading space** (`TWILIO_AUTH_TOKEN= <token>`). Remove the space so the value is the token with no whitespace — otherwise the Twilio client and signature validation fail with auth errors.
- **`PUBLIC_BASE_URL` is wrong.** It currently points at a `webhooks.twilio.com/...` template URL. It must be **your own public HTTPS tunnel to `localhost:3000`** (e.g. an ngrok URL like `https://abc123.ngrok-free.app`, no trailing slash). Twilio calls YOUR app at this base.
Add (reuse the existing Twilio number as the SMS sender — no API key needed for SMS):
```
# SMS uses TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER (already present).
# Local-only bypass of inbound signature check (never true in prod):
SMS_SKIP_SIGNATURE=false
```
Ensure `npm i twilio` is installed (add if missing).

## 2. Schema (`prisma/schema.prisma`, `Notification` model)
The alert row already exists as a `Notification` (fields: `userId, type, title, message, read, relatedDemandId, channel, createdAt`). Add three columns to track SMS delivery + the reply:
```prisma
outboundSid String?    // Twilio Message SID of the SMS we sent
accepted    Boolean  @default(false)
acceptedAt  DateTime?
```
Run `npx prisma db push && npx prisma generate`, then **restart the dev server**.

## 3. Outbound: send the SMS on a buyer match
The matching + notification fan-out already lives in **`src/lib/notifications.ts` → `notifyArtisansForDemand(demand)`** (lines ~96–136), called from **`src/app/api/demand/route.ts` POST** (line ~105) whenever a buyer posts a demand. Hook the SMS in there so it fires automatically on every real match:

1. New helper **`src/lib/sms.ts`**:
   - `export async function sendSms(to, body): Promise<{ sid?: string; skipped?: boolean; error?: string }>`.
   - Lazily construct the Twilio client from `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`. If any Twilio env is missing, **return `{ skipped: true }`** and log — never throw (dev without creds must still work).
   - `client.messages.create({ to, from: process.env.TWILIO_PHONE_NUMBER, body })`, return `{ sid }`; on error return `{ error }` (log it).
   - Include `export function toE164(raw): string | null` — normalize an Indian `mobileNumber`: strip non-digits; 10 digits → `+91XXXXXXXXXX`; `91` + 10 digits → `+` prefix; already `+…` → keep; else return null (skip unsendable).
2. In `notifyArtisansForDemand` (keep it **non-fatal** — SMS failure must never fail the demand post):
   - After the in-app `Notification` rows are written, for each matched artisan **who has a `mobileNumber`**, call `sendSms(toE164(mobileNumber), body)` where `body` is a compact SMS version of `demandAlertMessage(demand)` ending in **"Reply 1 to accept."** (keep it short, ideally ≤160 chars).
   - When the send returns a `sid`, update that artisan's notification row for this demand: set `outboundSid = sid` and `channel = 'SMS'`. (Match on `userId` + `relatedDemandId`.)
   - Keep the existing idempotency (don't double-alert an artisan already notified for this demand) so re-posts don't re-SMS.
   - Return the counts as before (optionally also return how many SMS were sent) so `/api/demand` can include it in its JSON.

## 4. Inbound: artisan replies "1" → webhook updates the DB
New route **`POST /api/sms/inbound/route.ts`** (Twilio Messaging webhook). ⚠️ Twilio posts **`application/x-www-form-urlencoded`** — read with `await req.formData()` (`From`, `Body`, `MessageSid`, `To`) and **respond with `Content-Type: text/xml`** TwiML.
1. **Validate `X-Twilio-Signature`** with the `twilio` SDK (`twilio.validateRequest(authToken, signature, url, params)`) against `PUBLIC_BASE_URL + '/api/sms/inbound'` and the POST params; 403 on failure. Allow a dev bypass ONLY when `NODE_ENV !== 'production'` AND `SMS_SKIP_SIGNATURE === 'true'`.
2. Normalize `From` and find the artisan: match `ArtisanProfile.mobileNumber` by **last 10 digits** (handles stored numbers with/without +91). Load the `User`/name.
3. Parse `Body.trim().toLowerCase()`:
   - **`1` or `yes`** → ACCEPT: find that artisan's most recent `Notification` where `type = 'DEMAND_ALERT'` and `accepted = false` (order by `createdAt desc`). Set `accepted = true`, `acceptedAt = now`, `read = true`. If it has a `relatedDemandId`, set that `Demand.status = 'MATCHED'`. Reply TwiML `<Message>`: *"Thank you {name}! We've recorded your interest in {craftType}. KARIGARI will connect you with the buyer."* If no pending alert exists, reply that there's no open demand to accept.
   - **`2` or `no`** → DECLINE: mark the latest pending alert `read = true` (and optionally an `accepted = false` decline note); reply *"No problem — we won't list this one."*
   - **anything else** → reply short help: *"Reply 1 to accept the latest demand, or 2 to skip."*
   - **no artisan match for the number** → reply *"This number isn't linked to a KARIGARI artisan account."* (still 200, still valid TwiML).
4. Keep everything non-fatal and always return valid TwiML (Twilio shows the caller an error otherwise).

## 5. Reflect the acceptance in the app (light touch)
- `src/app/api/artisan/notifications/route.ts` and the bell dropdown (`src/components/NotificationsBell.tsx`): show accepted demand alerts with an "Accepted ✓" state (use the new `accepted` field) so an artisan who replied by SMS sees it recorded when they next open the app. No heavy redesign — just a badge.

## 6. Guardrails
- SMS sending is **best-effort and non-fatal**; a Twilio/quota/verification failure must never break `/api/demand` or the app. Skip gracefully when env is unset.
- Inbound webhook: `formData()` in, `text/xml` out, **signature-validated**; never trust `From`/`Body` for anything but lookup.
- No secrets in code; `.env` only (gitignored). Don't print tokens.
- Reuse `craftMatchScore` / `demandAlertMessage` from `lib/notifications.ts`; don't fork the matching logic.

## 7. Run & verify (report results)
1. Fix `.env` (§1), `npm i twilio`, `npx prisma db push && npx prisma generate`, restart `npm run dev`.
2. `npx ngrok http 3000` → put the HTTPS URL in `PUBLIC_BASE_URL`.
3. Twilio Console → your number → **Messaging → "A message comes in" → Webhook → `https://<ngrok>/api/sms/inbound` (HTTP POST)**. Save.
4. Give the seeded/demo artisan a **verified** `mobileNumber` (trial can only SMS verified numbers). Post a matching demand at `/buyer` (or POST `/api/demand`). Confirm the artisan's phone receives the SMS ("…Reply 1 to accept").
5. Reply **`1`** from that phone → confirm a "Thank you" SMS back, the `Notification` row is `accepted=true`, and the `Demand` is `MATCHED` in the DB. Reply `2` and a garbage word to see decline/help paths.
6. Confirm a forged `curl` POST to `/api/sms/inbound` (no valid signature) is rejected 403.
7. `npx tsc --noEmit && npm run build` pass. Report files changed, the exact Twilio Messaging webhook URL, and confirm SMS send/receive worked.

## 8. Trial limits (keep honest in the pitch)
Twilio trial can only SMS **verified** numbers and prepends "Sent from your Twilio trial account"; inbound replies to the trial number work fine. So the demo needs the artisan's number verified. Framing: *"Artisans without smartphones/internet still get demand alerts by SMS and accept with a one-key reply — production swaps the trial number for a paid Indian long-code/short-code, no code change."*
