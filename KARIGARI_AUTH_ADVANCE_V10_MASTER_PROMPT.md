# KARIGARI — GOOGLE AUTH, PASSKEYS & DEMAND ADVANCE V10 MASTER PROMPT

> Three-stage execution workflow for Claude Code. Run PROMPT 1 to completion, then PROMPT 2, then PROMPT 3.
> Repo root for every path below: `KARIGARI/` (the Next.js app), not the outer folder.
> **Depends on V9** (`KARIGARI_DEMAND_SYNC_V9_MASTER_PROMPT.md`) for `ArtisanOrder.craftItemId` and `BuyerNotification`. If V9 has not landed, Feature B must degrade to console logging + the existing `Notification` model and say so in its output — never invent those tables.

---

## PROMPT 1 — PLANNING & ARCHITECTURE

You are a principal engineer and application-security reviewer working inside an existing Next.js 16.3.1 (App Router, React 19, TypeScript, Tailwind v4, Prisma 7 + PostgreSQL) codebase called KARIGARI. **Do not write feature code in this stage. Produce a written blueprint, a schema diff, and a threat model only.**

### Read these files first, in this order

Auth as it exists today
- `src/app/api/auth/register/route.ts` — bcrypt hash, creates `User` (+ nested `ArtisanProfile`), signs a 7-day JWT, sets httpOnly cookie `auth-token`
- `src/app/api/auth/login/route.ts` — `bcrypt.compare`, same JWT + cookie
- `src/app/api/auth/me/route.ts`, `src/app/api/auth/logout/route.ts`
- `src/lib/artisanAuth.ts` — `requireArtisan()`, the shared role gate
- `src/lib/authClient.ts` — client-side `logout()`
- `src/app/login/page.tsx` — Artisan/Admin segmented radiogroup, maroon CTA `bg-[var(--color-maroon)] text-[#F0A48C]`, `min-h-[52px]`, split-screen layout
- `src/app/register/page.tsx` — same role toggle, avatar picker, artisan-only required fields (`craftType`, `location`, `experienceYears`, `aadhaarLast4`, `annualIncome`, `gender` via `normalizeGender`)
- `prisma/schema.prisma` — `Role` enum is `ADMIN | ARTISAN` only; `User.passwordHash` is **non-null**; there is **no `middleware.ts`** — every protected handler verifies the JWT itself

Money as it exists today
- `src/lib/razorpay.ts` — `DEMO_CHARGE_PAISE = 100`, `RAZORPAY_CONFIGURED`, `RAZORPAY_LIVE`, `verifyRazorpaySignature()` (HMAC of `<order_id>|<payment_id>`, `timingSafeEqual`)
- `src/lib/razorpayMode.ts` — `RAZORPAY_LIVE_MODE` from the public key id
- `src/lib/escrow.ts` — `ADVANCE_RATE = 0.4`, `FINAL_SETTLEMENT_RATE = 0.4936`, `advanceFor()`, `SETTLEMENT_LABEL`, and the governance/honesty rules that bind this whole feature
- `src/app/api/payments/create-order/route.ts` — opens the Razorpay order at `DEMO_CHARGE_PAISE`, writes `escrowStatus = ESCROW_HELD`, `advanceAmount`, `finalSettlementAmount`, `artisanUpiDestination`, and an `AuditLog`
- `src/app/api/payments/verify-payment/route.ts` — HMAC check, then `SOLD_FINAL`, `paidAt`, `paidAmountPaise`, `buyerName`, `relatedDemandId`
- `src/app/api/payments/settle-escrow/route.ts` — `DISPATCH` → Stage 1, `DELIVERED` → Stage 2; idempotent by `escrowStatus`
- `src/app/api/artisan/orders/route.ts` — `POST` accept/negotiate creating `ArtisanOrder`; `src/app/api/artisan/orders/log/route.ts`
- `src/app/api/buyer/orders/delivered/route.ts` — credits `settledAmount` at the agreed price, guarded on `settledAt IS NULL`
- `src/components/BuyerOrders.tsx`, `src/app/marketplace/product/[id]/ProductClient.tsx` (the Razorpay Checkout client integration to mirror)
- `.env.example`, `src/app/globals.css`, `src/lib/i18n/en.ts | hi.ts | or.ts | te.ts`

### Fixed decisions — do not relitigate these

1. **Google + passkeys are for NEW accounts only.** Every existing account keeps signing in with email + password exactly as it does now. Nothing about the password path changes. Linking an existing password account to a Google identity is **explicitly out of scope** and will be done later — so an email that already belongs to a `PASSWORD` account must **refuse** to auto-link and must tell the user to sign in with their password for now.
2. **`@simplewebauthn/server` + `@simplewebauthn/browser` are approved dependencies.** Google OAuth stays dependency-free: hand-rolled authorization-code + PKCE, no `next-auth`. No other new packages.
3. **Charged amounts (approved):** the full-purchase demo charge moves from ₹1 to **₹10 (`DEMO_CHARGE_PAISE = 1000`)**, and the demand advance is **₹4 (`DEMO_ADVANCE_PAISE = 400`)** — exactly 40% of ₹10. Both clear Razorpay's 100-paise minimum, so both are real gateway orders.
4. **Displayed money stays real.** Only the *charged* amount is a demo constant. `askingPrice`, `salePrice`, `getListingPrice()`, the fair-wage floor, both escrow tranches, artisan earnings and the advance *shown* to a buyer (`advanceFor(agreedPrice)`) all remain the true rupee values. Do **not** force `askingPrice` to a constant on new listings — that would gut the fair-pay proof the product is built on.

### Confirm these blockers before designing (they are real, and they will bite)

1. **`User.passwordHash` is required.** A Google or passkey user has no password. It must become nullable, and every read of it (`bcrypt.compare` in the login route especially) must handle null without throwing or, worse, letting an empty comparison succeed.
2. **Artisan registration needs six fields Google cannot supply** (`craftType`, `location`, `experienceYears`, `aadhaarLast4`, `annualIncome`, `gender`). A Google sign-up therefore cannot create a usable artisan in one hop — it needs a completion step carrying a short-lived, server-signed pending identity.
3. **`AuditLog.craftItemId` is a required FK.** A demand advance has no natural `CraftItem` (this is why `/api/buyer/orders/delivered` documents "NEVER writes an AuditLog row here"). Decide per-route: write an audit row only when a bound `craftItemId` exists, otherwise console-log with a route prefix. Never invent a placeholder item.
4. **There is no payout rail.** `RAZORPAYX_ENABLED=false`; Razorpay Checkout collects into the *platform's* merchant account. An advance the buyer pays does **not** reach the artisan's VPA. Every label must follow `SETTLEMENT_LABEL`'s existing honesty framing — "programmatic settlement record", never "paid to the artisan".
5. **"₹1" is written into prose all over the app** — audit-log comment strings in `create-order` and `verify-payment`, `order_charged_note` and neighbours in all four i18n dictionaries, `src/lib/escrow.ts` doc comments, `src/lib/razorpay.ts`, `.env.example`, `README.md`. Changing the constant without sweeping the copy leaves the app lying to buyers.
6. **`rpID` / `origin` must match the browser's actual origin** or every WebAuthn ceremony fails silently in ways that look like a UI bug. Plan for `localhost` in dev and the deployed host in production, driven by env, with a startup-time sanity check.

### Deliver, as `docs/AUTH_ADVANCE_V10_PLAN.md`

**A. Prisma diff** (house comment style — explain *why*, name the writer of each field, never over-claim):
- `User`: `passwordHash String?` (was required — note the migration implication for existing rows: they keep their hash, nothing is lost), `authProvider String @default("PASSWORD")` (`PASSWORD | GOOGLE | PASSKEY`), `googleId String? @unique`, `emailVerified Boolean @default(false)`, `avatarUrl String?`.
- New `Passkey` model: `id`, `userId` + relation, `credentialId String @unique`, `publicKey String` (base64url), `counter Int @default(0)`, `transports String[]`, `deviceLabel String?`, `backedUp Boolean @default(false)`, `createdAt`, `lastUsedAt DateTime?`, `@@index([userId])`.
- `ArtisanOrder` (Feature B): `advanceStatus String @default("ADVANCE_PENDING")` (`ADVANCE_PENDING | ADVANCE_INITIATED | ADVANCE_PAID | ADVANCE_WAIVED`), `advanceDueAmount Float?` (the real 40% of the agreed price — what the buyer is shown), `advanceChargedPaise Int?` (what Razorpay actually took — 400), `advanceRazorpayOrderId String?`, `advanceRazorpayPaymentId String?`, `advanceRazorpaySignature String?`, `advancePaidAt DateTime?`, `balanceDueAmount Float?`, `@@index([advanceStatus])`.
- State plainly that this repo has **no `prisma/migrations/` directory**: the change lands via `npx prisma db push` + `npx prisma generate`, and every new column must be nullable or defaulted so existing rows survive untouched.

**B. Challenge and state storage.** Decide between short-lived signed httpOnly cookies and DB rows for the OAuth `state`/PKCE verifier/nonce and the WebAuthn challenge, and justify it. Default recommendation: **signed httpOnly cookies, 5-minute TTL, single-use** — no new table, no cleanup job, no cross-request DB read on the hot path. Specify the exact cookie names, flags (`httpOnly`, `sameSite: 'lax'`, `secure` in production, `path`), and how single-use is enforced.

**C. Google OAuth sequence**, as a numbered flow with the exact decision at each fork:
`/api/auth/google/start` (build authorization URL, PKCE S256, `state`, `nonce`, requested role, set cookie, 302) → Google → `/api/auth/google/callback` (validate `state`, exchange `code` at `https://oauth2.googleapis.com/token`, verify the `id_token` **signature** against Google's JWKS at `https://www.googleapis.com/oauth2/v3/certs` with a cached key set, check `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud === GOOGLE_CLIENT_ID`, `exp` fresh, `nonce` matches, `email_verified === true`) → then the three-way fork:
- `googleId` matches an existing user → sign in, issue the same `{ userId, role }` 7-day JWT, land on their dashboard.
- Email belongs to a `PASSWORD` account → **refuse**, redirect to `/login?notice=existing_password_account` with a plain, non-blaming message. No linking.
- No user at all → set a signed `pending-signup` cookie (sub, email, name, picture, 10-minute TTL) and redirect to `/register/complete`.
State `sub` — not email — is the identity key, and say why.

**D. Passkey ceremonies**, listing every route and its guard:
`POST /api/auth/passkey/register/options` and `/verify` (authenticated session **or** the `pending-signup` cookie), `POST /api/auth/passkey/login/options` and `/verify` (public), `GET`/`DELETE /api/auth/passkey` (authenticated, own credentials only). Specify: discoverable credentials, `userVerification: 'preferred'`, `residentKey: 'preferred'`, `attestation: 'none'`, the signature-counter regression check, `credentialId` uniqueness, and the **`authProvider !== 'PASSWORD'` gate** that keeps enrolment off legacy accounts.

**E. Advance-payment lifecycle**, as a state table: `ArtisanOrder.advanceStatus` × who may transition it × which endpoint writes it × what the buyer and artisan each see. Include the production gate — the artisan cannot log progress, mark ready, pack or dispatch until `advanceStatus === 'ADVANCE_PAID'` — and where the 60% balance lands (`/api/buyer/orders/delivered`, keeping its existing `settledAt IS NULL` idempotency guard).

**F. Threat model** — one row per attack, with the mitigation and the file that implements it: CSRF on the OAuth callback, authorization-code interception, `id_token` forgery, replayed WebAuthn assertions, cloned-authenticator (counter regression), passkey enrolment onto someone else's account, a forged `payment_id` at the advance-verify route, double-payment of the same advance, one buyer paying another buyer's advance, and an artisan self-marking an advance paid.

**G. File-by-file work order** and **H. rollback plan** (every change must be revertable by flipping an env flag or removing a route, without stranding data).

Constraints: no `middleware.ts`; per-route guards stay the pattern. Every user-visible string is an i18n key present in all four dictionaries. Existing design tokens only. Both features must degrade honestly when unconfigured — the established pattern is `RAZORPAY_CONFIGURED` → 503 with a plain message and `GEMINI_CONFIGURED` → documented fallback; never a stack trace and never a dead button.

---

## PROMPT 2 — IMPLEMENTATION

Implement `docs/AUTH_ADVANCE_V10_PLAN.md`. Production quality: typed, guarded, idempotent, themed, translated. Keep the app building after each numbered block.

## FEATURE A — GOOGLE SIGN-IN + PASSKEYS (NEW ACCOUNTS ONLY)

### A0. Dependencies and schema
`npm install @simplewebauthn/server @simplewebauthn/browser`. Apply the planned Prisma diff, run `npx prisma generate`, and state in your output that `npx prisma db push` is required against a live `DATABASE_URL`. Do not fabricate migration files.

### A1. Environment — extend `.env.example` in its existing commented style
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_NAME=KARIGARI
WEBAUTHN_ORIGIN=http://localhost:3000
NEXT_PUBLIC_PASSKEY_ENABLED=false
```
Document what each does, that the redirect URI must be registered byte-for-byte in the Google Cloud console, and that `WEBAUTHN_RP_ID` is the bare hostname (no scheme, no port) while `WEBAUTHN_ORIGIN` is the full origin.

### A2. `src/lib/authSession.ts` (new)
Extract the JWT signing + cookie-setting that `login` and `register` currently duplicate into one `issueSession(user)`, and add `getSession()` returning `{ userId, role } | null`. Use it everywhere, including the new routes. Same secret fallback behaviour, same 7-day expiry, same cookie flags — this is a refactor, not a change in behaviour.

### A3. `src/lib/googleAuth.ts` (new)
`buildAuthUrl()`, `exchangeCode()`, `verifyIdToken()`. PKCE S256. JWKS fetched and cached in module scope with a TTL, verified with `node:crypto` (`createPublicKey` from the JWK, `createVerify('RSA-SHA256')`) — no new dependency. Validate `iss`, `aud`, `exp`, `nonce`, `email_verified`. Export `GOOGLE_CONFIGURED`. Every failure returns a typed result, never throws into a route.

### A4. Google routes
- `GET /api/auth/google/start` — accepts `?role=ARTISAN|ADMIN`, generates verifier/state/nonce, sets the single-use `google-oauth` cookie, 302s to Google. 503 with a plain message when `!GOOGLE_CONFIGURED`.
- `GET /api/auth/google/callback` — implement the three-way fork from the plan exactly. Clear the state cookie on every path, success or failure. Never return a stack trace to the browser: redirect to `/login?notice=<code>` and render a friendly message from an i18n key.
- `POST /api/auth/google/complete` — reads the `pending-signup` cookie, validates role and the artisan-required fields with the **same rules as `/api/auth/register`** (reuse them; do not re-implement and drift), creates the `User` with `passwordHash: null`, `authProvider: 'GOOGLE'`, `googleId`, `emailVerified: true`, `avatarUrl`, plus the nested `ArtisanProfile` when the role is ARTISAN, clears the pending cookie, and issues the session. Re-check that the email and `googleId` are still unused inside the transaction — the cookie is 10 minutes old and the world may have moved.

### A5. Passkey routes — `src/lib/passkey.ts` + four handlers
Wrap `@simplewebauthn/server` in one lib exporting `PASSKEY_CONFIGURED` and the four ceremony helpers with the options from the plan. Then:
- `register/options` + `register/verify` — **403 when `user.authProvider === 'PASSWORD'`** with a clear message ("Passkeys are available on accounts created with Google sign-in. Your existing account continues to use its password."). Store the credential; label it from the User-Agent (e.g. "Chrome on Windows") for a recognisable list.
- `login/options` + `login/verify` — usernameless where the authenticator supports it. On verify: look the credential up by `credentialId`, **reject a counter that did not advance** (unless both stored and returned are 0, which some authenticators do), update `counter` and `lastUsedAt`, issue the session.
- `GET`/`DELETE /api/auth/passkey` — list and revoke, scoped to the signed-in user. Deleting the last passkey on a `PASSKEY`-provider account must be refused, or that account locks itself out.

### A6. `src/app/api/auth/login/route.ts` — the one existing file that must change
Handle `passwordHash === null`: return the same generic `Invalid credentials` 401 (never reveal which provider an email uses — that is an account-enumeration leak), but log the real reason server-side. **Never call `bcrypt.compare` with a null hash.** Nothing else about this route moves.

### A7. UI

`src/app/login/page.tsx` — below the existing password form, a `border-t border-gray-200` divider with a centred "or" chip, then:
- **Continue with Google** — white button, `border border-gray-200`, official Google "G" as inline SVG (do not fetch a remote asset — the CSP and the offline PWA both forbid it), `min-h-[52px]`, `kg-press`.
- **Sign in with a passkey** — same height, `bg-gray-100`, `Fingerprint` icon from lucide.
Each button renders only when its `NEXT_PUBLIC_*_ENABLED` flag is on **and** the browser supports it (`window.PublicKeyCredential` for passkeys) — an unsupported browser gets no dead button. Render `?notice=` messages in the existing red alert box.

`src/app/register/page.tsx` — "Continue with Google" above the form, with a one-line note that Google sign-up finishes on the next screen. The existing form is untouched.

`src/app/register/complete/page.tsx` (new) — Google avatar and name at the top, email read-only, then the role toggle and the artisan fields lifted from the register page. Reuse the same field components and validation so the two screens cannot drift. Offer "Set up a passkey" as an optional final step after the account is created, with a clear skip.

`src/components/ProfileEditorModal.tsx` — a **Sign-in methods** section listing enrolled passkeys (label, created, last used) with add and remove. Hidden entirely for `authProvider === 'PASSWORD'` accounts.

## FEATURE B — 40% ADVANCE ON DEMAND ACCEPTANCE

### B1. Money constants — `src/lib/razorpay.ts`
Change `DEMO_CHARGE_PAISE` from `100` to `1000` and add `export const DEMO_ADVANCE_PAISE = 400;`. Rewrite the surrounding doc comment so it states the new figures, why 40% of the ₹10 demo value is ₹4, that both clear Razorpay's 100-paise minimum, and — unchanged and prominent — that in live mode these are **real debits** into the platform merchant account. Keep the existing "how to bill the real price" revert note accurate.

### B2. Sweep every "₹1" in the codebase
`grep -rn "₹1\b\|DEMO_CHARGE_PAISE\|100 paise\|one rupee" src/ docs/ README.md .env.example` and update every hit: the audit-log comment strings in `create-order` and `verify-payment`, `order_charged_note` and its siblings in `en.ts`/`hi.ts`/`or.ts`/`te.ts`, `src/lib/escrow.ts` doc comments, `src/lib/razorpayMode.ts`, `.env.example`, `README.md`. The invariant to preserve everywhere: **displayed price is real; charged amount is the demo constant.** Leave no copy claiming ₹1.

### B3. Advance ledger on acceptance — `src/app/api/artisan/orders/route.ts`
In the existing accept/negotiate transaction, also write `advanceDueAmount = advanceFor(negotiatedPrice ?? demand.targetPriceMax ?? demand.targetPriceMin ?? 0)`, `balanceDueAmount = agreed − advanceDueAmount`, `advanceStatus = 'ADVANCE_PENDING'`. When no price can be resolved, leave the amounts null and set `ADVANCE_WAIVED` — never persist a `0` advance as though it were a real figure. Notify the buyer that an advance is due (V9 `BuyerNotification`, or console-log with a clear prefix if V9 has not landed).

### B4. Advance checkout — two new routes under `src/app/api/payments/demand-advance/`
- `POST create-order` — public, body `{ artisanOrderId, buyerName }`. Verify the order's `Demand.buyerName` matches case-insensitively (the pattern `/api/buyer/orders/delivered` already uses). Guard on `advanceStatus === 'ADVANCE_PENDING' | 'ADVANCE_INITIATED'`; a paid advance short-circuits with `alreadyPaid: true`. 503 when `!RAZORPAY_CONFIGURED`. Create the Razorpay order for `DEMO_ADVANCE_PAISE` with notes carrying `artisanOrderId`, `demandId`, `displayAdvance` (the real 40%) and `stage: 'DEMAND_ADVANCE_40'`. Persist `advanceRazorpayOrderId`, set `ADVANCE_INITIATED`. Return `{ orderId, amount, currency, keyId }` — the **public** key id only.
- `POST verify` — public, body `{ artisanOrderId, buyerName, razorpay_order_id, razorpay_payment_id, razorpay_signature }`. Re-check buyer ownership, confirm `razorpay_order_id` equals the stored `advanceRazorpayOrderId` (a signature valid for a *different* order must not settle this one), then `verifyRazorpaySignature()`. Only on success, in one transaction: write the payment id, signature, `advancePaidAt`, `advanceChargedPaise = DEMO_ADVANCE_PAISE`, `advanceStatus = 'ADVANCE_PAID'`, and move `ArtisanOrder.status` to `IN_PROGRESS`. Idempotent on `advancePaidAt IS NULL`. Notify the artisan ("advance received — you can begin") and the buyer. Audit row **only** when `craftItemId` is bound; otherwise a prefixed `console.log`.

### B5. Production gate
`POST /api/artisan/orders/log` and the V9 ready / pack / dispatch actions return **409** with an actionable message when `advanceStatus !== 'ADVANCE_PAID'` and the order is not `ADVANCE_WAIVED`. Surface it on the artisan card as a calm waiting state ("Waiting for the buyer's 40% advance"), not an error.

### B6. Buyer UI — `src/components/BuyerOrders.tsx`
An advance panel on any order with `advanceStatus === 'ADVANCE_PENDING' | 'ADVANCE_INITIATED'`: the real 40% figure, the balance due on delivery, and a **Pay 40% advance** button that loads Razorpay Checkout exactly the way `ProductClient.tsx` already does (same script-load guard, same `handler`, same failure handling — extract the shared logic rather than copy-pasting a third copy). Beneath it, in the existing muted-note style, the honest line: what was actually charged (₹4) versus the advance recorded, and that settlement to the artisan is a programmatic record, not a bank credit. Once paid, show a settled state with the date. Never claim the artisan received the money.

### B7. Balance on delivery — `src/app/api/buyer/orders/delivered/route.ts`
Credit `balanceDueAmount` when the advance was paid, and the full agreed price when it was waived. Keep the `settledAt IS NULL` guard and the existing `updateMany` concurrency pattern. Advance + balance must equal the agreed price to the rupee — assert it and log a warning if it ever does not.

### B8. i18n
Every new string in all four dictionaries with real Hindi / Odia / Telugu translations, not English placeholders. Follow existing key naming (`auth_*`, `passkey_*`, `advance_*`).

### Engineering rules — non-negotiable
- Match the surrounding code exactly: `"use client"` only where needed, `export const dynamic = 'force-dynamic'` on every handler reading request state, `NextResponse.json` with real status codes, `try/catch` + route-prefixed `console.error`.
- Comments explain **why**, in full sentences, in this repo's existing voice. No banner comments.
- Theme: existing tokens only (`--color-maroon`, `--color-primary`, `--color-pill`, the warm gray ramp). No new colours or fonts. Mobile-first, tap targets ≥44px.
- Secrets: `GOOGLE_CLIENT_SECRET`, `RAZORPAY_KEY_SECRET` and the WebAuthn private material are read server-side only. **Never add a `NEXT_PUBLIC_` alias for any secret** — Next inlines those into the browser bundle.
- Never reveal which provider an email uses in an unauthenticated response.
- Every mutating endpoint idempotent and double-submit safe; every state machine monotonic.
- No `any`, no unused imports, no `console.log` left in UI components.

---

## PROMPT 3 — REVIEW, TESTING & OPTIMISATION

Audit the V10 implementation across the whole codebase. Report findings as a table (file · line · severity · defect · fix), apply every Critical and High fix, then re-verify. Do not declare done on partial work.

### A. Gates — run these, paste real output
```
npx prisma generate
npx tsc --noEmit
npm run lint
npm run build
```
Zero type errors, zero lint errors, clean production build. If a gate needs a live database or real OAuth keys, say so explicitly rather than skipping it silently.

### B. Full-file sweep
Open every file created or edited plus everything importing them, and confirm: no stale references; `passwordHash` is null-safe at **every** read site (grep it); no `select:`/`include:` naming a field that does not exist; the four i18n dictionaries have identical key sets (write and run a throwaway diff script, paste the result); every `t("...")` in changed files resolves.

### C. Auth trace — walk the code and prove each case
1. Existing password user signs in → unchanged, lands on the right dashboard. **Regression-check this first; it is the one thing that must not break.**
2. Brand-new Google user → completion screen → artisan created with `passwordHash: null`, `authProvider: 'GOOGLE'`, `emailVerified: true`, profile populated, session issued.
3. Google email that already belongs to a `PASSWORD` account → refused with the friendly notice, **no user mutated, no session issued**.
4. Returning Google user → signs straight in by `googleId`.
5. Passkey enrolment on a Google account → succeeds; on a `PASSWORD` account → 403 with the explanatory message.
6. Passkey login → session issued, `counter` and `lastUsedAt` advanced.
7. Deleting the last passkey on a passkey-only account → refused.
8. Tampered `state`, replayed `code`, `id_token` with a wrong `aud`, expired `exp`, mismatched `nonce`, `email_verified: false` → each rejected with no session issued and no row written. Trace all six.
9. Replayed WebAuthn assertion and a regressed counter → both rejected.
10. `GOOGLE_CONFIGURED` / `PASSKEY_CONFIGURED` false → buttons absent, routes 503 with a plain message, password login unaffected.

### D. Advance trace
11. Artisan accepts a demand → `advanceDueAmount` is the real 40% of the agreed price; `advanceStatus = 'ADVANCE_PENDING'`; buyer notified.
12. Artisan tries to log progress / mark ready before payment → 409, waiting state renders.
13. Buyer pays → Razorpay order is **400 paise**; verify writes the ledger; status → `IN_PROGRESS`; artisan notified; the UI shows the real 40% and the ₹4 charge without conflating them.
14. Double-click Pay, and re-POST verify with the same payload → exactly one advance recorded, no double credit.
15. Buyer "Y" attempts to pay buyer "X"'s advance → 403.
16. A signature valid for a *different* Razorpay order is POSTed → rejected.
17. Forged `razorpay_payment_id` with no valid signature → rejected, nothing written.
18. Delivery credits the balance; advance + balance === agreed price exactly.
19. A demand with no resolvable price → `ADVANCE_WAIVED`, no zero-rupee advance persisted, delivery credits the full agreed price.
20. A full storefront purchase now charges **1000 paise**, and every displayed price is still the real listing price.

For each: the endpoint, the rows written, the notifications created, the components that re-render.

### E. Security review
- No secret reachable from the client bundle: `grep -rn "NEXT_PUBLIC_" src/` and confirm every hit is genuinely public.
- Every OAuth/WebAuthn cookie: `httpOnly`, `sameSite`, `secure` in production, correct `path`, single-use, TTL enforced server-side.
- No account enumeration: sign-in failures are indistinguishable regardless of provider.
- Passkey enrolment cannot be pointed at another user's account (check the user id binding on both the options and verify legs).
- Rate-limiting or at minimum a documented gap on the auth and advance endpoints.
- No PII, patch id, contact number or provider detail leaking through a public route.

### F. Performance and UX
- JWKS cached, not re-fetched per callback. No N+1 in the passkey list or the advance panel. Every new query path has a supporting index.
- Every new control: label, accessible name, keyboard operable, visible focus ring; modals trap focus and close on Escape.
- Loading, empty, error and unsupported-browser states exist on every new surface. Nothing at 360px width overflows.
- Theme audit: no new colour, radius, shadow or font escaped the token set.

### G. Documentation
- `ARCHITECTURE.md` — its Auth row still says JWT + bcrypt only, and its Buyer section is materially out of date. Correct both, and add the advance to the status machine.
- `docs/CONTRACT.md` — every new endpoint with its guard.
- `README.md` — Google Cloud OAuth setup (authorised redirect URI), WebAuthn env, the ₹10 / ₹4 demo charges, and `prisma db push`.
- A short `docs/AUTH_V10_RUNBOOK.md`: how to rotate the Google secret, how to revoke a passkey for a locked-out user, and how to flip either feature off with an env flag.

### H. Final report
Gates with real output · findings table with what was fixed · results for all 20 traces · anything deliberately left undone and why. Do not claim a trace verified that you did not actually walk in the code.
