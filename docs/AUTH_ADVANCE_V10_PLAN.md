# V10 — Google Sign-in, Passkeys & the 40% Demand Advance

Blueprint, schema diff and threat model. No feature code lands from this
document; PROMPT 2 does that.

Repo root for every path: `KARIGARI/`.

**V9 has landed.** `ArtisanOrder.craftItemId` and the `BuyerNotification` model
both exist in `prisma/schema.prisma` and are live in the database, so Feature B
uses them directly. No degraded console-only path is needed.

---

## 0. The six blockers, verified in the code

| # | Blocker | Verified | Severity |
|---|---|---|---|
| 1 | `User.passwordHash` is **required**. `src/app/api/auth/login/route.ts` calls `bcrypt.compare(password, user.passwordHash)` with no null branch. | `prisma/schema.prisma` (`passwordHash String`), login route | **Blocking.** Making the column nullable turns that call into a TypeScript error, which is the good outcome — it fails at `tsc`, not silently at runtime. There is exactly one such call site in the repo. |
| 2 | Artisan registration needs six fields Google cannot supply. | `src/app/api/auth/register/route.ts` requires `aadhaarLast4`, `annualIncome` and a `normalizeGender()`-valid `gender`; the nested `ArtisanProfile` also takes `craftType`, `location`, `experienceYears`. | **Blocking.** A Google sign-up cannot mint a usable artisan in one hop. |
| 3 | `AuditLog.craftItemId` is a required FK with a relation to `CraftItem`. | `prisma/schema.prisma`; `/api/buyer/orders/delivered` already documents *"NEVER writes an AuditLog row here"* for exactly this reason. | Real. Per-route decision, below. |
| 4 | No payout rail. `RAZORPAYX_ENABLED=false`; Checkout collects into the **platform's** merchant account. | `.env.example`, `src/lib/escrow.ts` header | Real. Every advance label follows `SETTLEMENT_LABEL`'s framing. |
| 5 | **58 hits** for `₹1` / `DEMO_CHARGE_PAISE` / "one rupee" across `src/`, `docs/`, `README.md`, `.env.example`. | `grep -rn "₹1\b\|DEMO_CHARGE_PAISE\|100 paise\|one rupee"` | Real, and larger than it looks — see the trap below. |
| 6 | `rpID` / `origin` must equal the browser's real origin or every ceremony fails in ways that look like a UI bug. | WebAuthn spec; nothing in the repo sets it yet | Real. Env-driven, with a startup sanity check. |

### The trap in blocker 5

`grep "₹1"` also matches **`₹15,000`**, **`₹1 lakh`** and **`₹1,200`**. One live
example:

```
src/lib/i18n/en.ts:166
scheme_pm_vishwakarma_benefit: "₹15,000 toolkit e-voucher • collateral-free loan up to ₹3 lakh at 5% • ₹500/day training stipend"
```

That is a real government scheme benefit. A careless sweep rewrites it to
"₹105,000". **The sweep must anchor on `₹1` followed by a non-digit,
non-comma** — and the five i18n keys that genuinely need changing are exactly:
`razorpay_test_note`, `razorpay_live_note`, `mp_live_note`,
`payment_success_body_live`, `order_charged_note`. Nothing else in the four
dictionaries mentions the charge.

### Two further findings

- **F14 — there is no rate limiting anywhere in this repo.** `grep -rn "rateLimit\|429"`
  returns only comments about Gemini quota. The auth and advance endpoints will
  ship without it, which is a *documented gap*, not an oversight — see §F.
- **F15 — only two `NEXT_PUBLIC_` variables exist today** (`NEXT_PUBLIC_BASE_URL`,
  `NEXT_PUBLIC_RAZORPAY_KEY_ID`), both genuinely public. V10 adds two more
  feature flags and no secrets. The rule stays absolute.

---

## A. Prisma diff

### A.1 `model User`

```prisma
  /// Null for accounts created through Google or a passkey — those identities
  /// have no password to hash. Every EXISTING row keeps the hash it already
  /// has; making the column nullable takes nothing away.
  ///
  /// The one read site is `bcrypt.compare` in /api/auth/login, which must
  /// branch on null BEFORE calling compare: bcryptjs throws on a null hash, and
  /// a caught throw that fell through to "valid" would be a total auth bypass.
  passwordHash   String?
  /// PASSWORD | GOOGLE | PASSKEY. How this account was created, and therefore
  /// which sign-in paths it may use. Defaulted so every row written before V10
  /// reads PASSWORD, which is what those rows actually are.
  authProvider   String  @default("PASSWORD")
  /// Google's `sub` claim. Unique so one Google identity cannot be attached to
  /// two accounts. Null for password and passkey-only accounts.
  googleId       String? @unique
  /// True only when Google asserted `email_verified`. This app never sends a
  /// verification mail of its own, so a PASSWORD account stays false — and
  /// nothing is gated on it yet. It records what we were told, not what we checked.
  emailVerified  Boolean @default(false)
  /// Google's `picture` claim, stored as the remote URL rather than copied into
  /// a data URL: it is already public, and re-hosting it would put a third
  /// party's CDN content into our own rows.
  avatarUrl      String?

  passkeys       Passkey[]
```

### A.2 New `model Passkey`

```prisma
/// One WebAuthn credential belonging to one user.
///
/// The private key never leaves the authenticator; what is stored here is the
/// public half plus the bookkeeping needed to detect a cloned authenticator.
/// `counter` is the load-bearing field: a genuine authenticator's signature
/// counter only ever increases, so a replayed or cloned assertion shows up as a
/// counter that did not advance.
model Passkey {
  id            String    @id @default(uuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// base64url, as returned by the browser. Unique across the whole table: one
  /// physical credential must never map to two accounts.
  credentialId  String    @unique
  /// base64url-encoded COSE public key.
  publicKey     String
  /// Signature counter. Some authenticators (notably platform passkeys that
  /// sync) always report 0; the verify route treats 0-and-still-0 as the one
  /// legitimate non-advance and rejects every other regression.
  counter       Int       @default(0)
  /// usb | nfc | ble | internal | hybrid, as the browser reported them. Fed
  /// back into the next login's `allowCredentials` so the right prompt appears.
  transports    String[]
  /// Derived from the User-Agent at enrolment ("Chrome on Windows") so a person
  /// with three passkeys can tell which one to revoke.
  deviceLabel   String?
  /// Whether the credential is backed up / synced. Shown in the list because a
  /// device-bound key is lost with the device and a synced one is not.
  backedUp      Boolean   @default(false)
  createdAt     DateTime  @default(now())
  lastUsedAt    DateTime?

  @@index([userId])
}
```

`onDelete: Cascade` is deliberate: a deleted user's credentials are meaningless,
and leaving orphans would let a `credentialId` stay claimed forever.

### A.3 `model ArtisanOrder` — Feature B

```prisma
  /// ADVANCE_PENDING | ADVANCE_INITIATED | ADVANCE_PAID | ADVANCE_WAIVED.
  /// Written by /api/artisan/orders (on acceptance) and the two routes under
  /// /api/payments/demand-advance. Monotonic, like every other status in this
  /// schema — see src/lib/orderStage.ts.
  advanceStatus            String   @default("ADVANCE_PENDING")
  /// The REAL 40% of the agreed price — `advanceFor(agreed)`. This is the
  /// number the buyer is shown and the number the artisan is told is coming.
  /// Null when no price could be resolved, which is also when advanceStatus is
  /// ADVANCE_WAIVED: a zero-rupee advance is not a fact, it is a missing one.
  advanceDueAmount         Float?
  /// What Razorpay ACTUALLY took, in paise — DEMO_ADVANCE_PAISE (400). Kept
  /// separate from `advanceDueAmount` for the same reason
  /// `CraftItem.paidAmountPaise` is kept separate from `salePrice`: one is the
  /// demo charge, the other is the real figure, and conflating them would be
  /// the single most misleading thing this app could do.
  advanceChargedPaise      Int?
  advanceRazorpayOrderId   String?
  /// Written ONLY after the HMAC signature checks out, in /demand-advance/verify.
  advanceRazorpayPaymentId String?
  advanceRazorpaySignature String?
  /// Presence is the idempotency guard: the verify route's updateMany predicate
  /// is `advancePaidAt: null`, so a double-submit cannot record two advances.
  advancePaidAt            DateTime?
  /// The remaining 60%, credited on delivery. advanceDueAmount +
  /// balanceDueAmount must equal the agreed price to the rupee.
  balanceDueAmount         Float?

  @@index([advanceStatus])
```

**On that index.** V9's audit removed three indexes that had no query behind
them, and the same test applies here: `@@index([advanceStatus])` ships **only
if** a route actually filters on it. The buyer's orders route loads by
`demandId` and the artisan's by `artisanId`, both already indexed, and filters
status in JavaScript. Unless PROMPT 2 adds a real `where: { advanceStatus }`
query, **this index should be dropped** rather than carried as a false promise.
The decision belongs to whoever writes B3/B4 — it is flagged here so it is made
deliberately.

### A.4 Migration

No `prisma/migrations/` directory exists. The change lands as:

```bash
npx prisma db push --url "$DIRECT_URL"   # bare db push hangs on the pooler
npx prisma generate
```

Every new column is nullable or defaulted, so existing rows survive untouched.
`passwordHash String` → `String?` is a *widening* change: Postgres drops the NOT
NULL constraint and no data moves.

---

## B. Challenge and state storage

**Decision: short-lived signed httpOnly cookies. No new table.**

| Option | Why not |
|---|---|
| DB rows | Two extra round-trips on the hot path of every sign-in, plus a cleanup job for abandoned ceremonies that nobody will write, plus a table that grows forever on a demo deployment. The data is single-use and lives for five minutes. |
| Unsigned cookies | The `state` and `nonce` must be *unforgeable*. An attacker who can set the cookie can complete a CSRF. |
| **Signed httpOnly cookies** | ✅ The value is server-authored and HMAC-signed with `JWT_SECRET`, so tampering is detectable; `httpOnly` keeps it out of scripts; it expires on its own; there is nothing to clean up. |

### Exact cookies

| Name | Contents | TTL | Flags |
|---|---|---|---|
| `google-oauth` | `{ state, verifier, nonce, role }`, signed as a JWT | 5 min | `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/api/auth/google'` |
| `pending-signup` | `{ sub, email, name, picture }`, signed | 10 min | `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'` |
| `webauthn-challenge` | `{ challenge, userId? }`, signed | 5 min | `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/api/auth/passkey'` |

`sameSite: 'lax'` rather than `'strict'`: Google's callback is a **cross-site
top-level GET**, and `strict` would withhold the cookie on exactly the request
that needs it. `lax` sends it on top-level navigations, which is precisely this
case and not a form POST from an attacker's page.

`path` is scoped so the OAuth and WebAuthn cookies are not attached to every
request in the app. `pending-signup` needs `/` because `/register/complete` is a
page, not an API route.

### Single-use enforcement

Every consumer **deletes the cookie before it does anything else** — read,
delete, then validate. A replayed callback therefore finds no cookie and is
rejected as a state mismatch, whether the first attempt succeeded or failed.
This is why the callback clears `google-oauth` on *every* path including error
paths, not just on success.

The TTL is enforced twice: by the cookie's own `maxAge` (the browser stops
sending it) and by the signed payload's `exp` (the server refuses it even if a
client replays a saved value). The second is the one that matters.

---

## C. Google OAuth sequence

`sub` is the identity key, **not email.** A Google account's email address can
change, and Google explicitly documents `sub` as the only stable, never-reused
identifier. Keying on email would also mean a person who changes their Google
email loses their account, and — worse — that an email freed up and reissued
inside a Workspace domain could inherit someone else's history.

### `GET /api/auth/google/start`

1. `!GOOGLE_CONFIGURED` → **503**, plain message. No redirect to a broken Google page.
2. Read `?role=` — `ARTISAN | ADMIN`, anything else → `ARTISAN`.
3. Generate `verifier` (43–128 chars, base64url random), `challenge = S256(verifier)`, `state` (32 random bytes), `nonce` (32 random bytes).
4. Set the signed `google-oauth` cookie.
5. **302** to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, `access_type=online`, `prompt=select_account`.

### `GET /api/auth/google/callback`

Each numbered step, on failure, **clears the cookie and redirects to
`/login?notice=<code>`**. Never a stack trace, never a 500 page.

1. `?error=` present (user cancelled) → `notice=google_cancelled`.
2. Read + **delete** the `google-oauth` cookie. Missing or unsigned → `notice=google_state`.
3. Verify the signed payload; expired → `notice=google_state`.
4. `state` from the query must equal `state` from the cookie → else `notice=google_state`. **This is the CSRF defence.**
5. Exchange `code` at `https://oauth2.googleapis.com/token` with `code_verifier`. Non-200 → `notice=google_exchange`.
6. Verify the `id_token` **signature** against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`), key selected by `kid`, cached in module scope with a TTL. A `kid` miss forces one refetch, then fails.
7. Claim checks, all mandatory: `iss ∈ {accounts.google.com, https://accounts.google.com}` · `aud === GOOGLE_CLIENT_ID` · `exp` in the future · `nonce` equals the cookie's · `email_verified === true`. Any failure → `notice=google_token`.

Then the three-way fork:

| Case | Action |
|---|---|
| `googleId` matches a `User` | Issue the standard `{ userId, role }` 7-day JWT. Redirect to that role's dashboard. |
| No `googleId` match, but the **email** belongs to a `PASSWORD` account | **Refuse.** No mutation, no session. Redirect to `/login?notice=existing_password_account`. Message: *"This email already has a KARIGARI account with a password. Please sign in with your password for now."* Non-blaming, and it does not say the account is Google-less in a way that helps an attacker — the person already proved they control that Google email. |
| No user at all | Set the signed `pending-signup` cookie, redirect to `/register/complete`. |

**Why refusing to auto-link is the right call.** Auto-linking on a matching
email means: control the email at Google, get the KARIGARI account. That is a
full account takeover for any user whose KARIGARI email is a Gmail address they
no longer control, or whose Workspace domain was recycled. Linking is a
deliberate, authenticated action — it belongs behind an existing session, and it
is out of scope here.

### `POST /api/auth/google/complete`

1. Read + delete `pending-signup`. Missing or expired → 401.
2. Validate role and the artisan-required fields **through the same helper the
   register route uses**. PROMPT 2 extracts that validation out of
   `/api/auth/register` into `src/lib/registrationRules.ts` and has both call it,
   so the two screens cannot drift.
3. **Inside the transaction**, re-check that the email and `googleId` are still
   unused. The cookie is up to ten minutes old; someone may have registered that
   email by password in the meantime, and the fork decision made at step 2 of the
   callback is stale by then.
4. Create the `User` with `passwordHash: null`, `authProvider: 'GOOGLE'`,
   `googleId`, `emailVerified: true`, `avatarUrl`, plus the nested
   `ArtisanProfile` when the role is `ARTISAN`.
5. Issue the session, clear the pending cookie, return the same shape
   `/api/auth/register` returns.

---

## D. Passkey ceremonies

`src/lib/passkey.ts` wraps `@simplewebauthn/server` and exports
`PASSKEY_CONFIGURED` plus four helpers. Shared options:

- `attestation: 'none'` — this app has no attestation policy to enforce, and asking for one leaks device model for nothing.
- `residentKey: 'preferred'`, `requireResidentKey: false` — discoverable where supported, so usernameless login works, without excluding older keys.
- `userVerification: 'preferred'` — not `'required'`: a security key with no PIN is still a large security gain over a password, and requiring UV would silently exclude those users.
- `rpID` from `WEBAUTHN_RP_ID` (bare hostname), `origin` from `WEBAUTHN_ORIGIN` (full origin). A **startup sanity check** logs a loud warning when `new URL(WEBAUTHN_ORIGIN).hostname !== WEBAUTHN_RP_ID`, because that mismatch produces silent ceremony failures that read as UI bugs.

| Route | Guard | Notes |
|---|---|---|
| `POST /api/auth/passkey/register/options` | Session **or** valid `pending-signup` cookie | **403 when `user.authProvider === 'PASSWORD'`.** `excludeCredentials` lists the user's existing credentials so the same key cannot be enrolled twice. The `userId` is taken from the session — **never from the request body**. Challenge → `webauthn-challenge` cookie, bound to that `userId`. |
| `POST /api/auth/passkey/register/verify` | Same | Re-reads the `userId` from the challenge cookie and asserts it equals the session's. Stores `credentialId`, `publicKey`, `counter`, `transports`, `backedUp`, `deviceLabel`. A duplicate `credentialId` is a unique-constraint violation → 409, not a 500. |
| `POST /api/auth/passkey/login/options` | Public | No `allowCredentials` when no email is supplied — usernameless. Challenge cookie carries **no** `userId`; the credential decides who it is. |
| `POST /api/auth/passkey/login/verify` | Public | Look up by `credentialId`. **Counter regression check.** On success: bump `counter`, set `lastUsedAt`, issue the session. |
| `GET /api/auth/passkey` | Session | The caller's own credentials only. Returns label, created, last used, `backedUp` — **never `publicKey` or `credentialId`**. |
| `DELETE /api/auth/passkey` | Session | Scoped by `userId` in the delete predicate. **Refuses to delete the last credential on an `authProvider === 'PASSKEY'` account**, which would lock that account out permanently — there is no password to fall back to and no email recovery in this app. |

### The counter rule, precisely

```
if (stored > 0 || returned > 0) {
  if (returned <= stored) reject;   // cloned or replayed
}
// both 0: allowed. Synced platform passkeys legitimately never increment.
```

Rejecting `returned === 0 && stored === 0` would break Apple and Google
platform passkeys entirely. Accepting `returned <= stored` when either is
non-zero would defeat the only clone detection WebAuthn offers.

### The enrolment gate

`authProvider === 'PASSWORD'` → **403**, message: *"Passkeys are available on
accounts created with Google sign-in. Your existing account continues to use its
password."* This is the fixed decision from the brief, and it is also what keeps
the blast radius small: a password account cannot gain a second, weaker-to-recover
credential path without a deliberate linking flow that does not exist yet.

---

## E. Advance-payment lifecycle

`advanceFor(agreed)` is the existing `src/lib/escrow.ts` helper — 40%, rounded
to whole rupees. V10 does not introduce a second definition of "the advance".

| From | To | Who | Endpoint | Writes | Buyer sees | Artisan sees |
|---|---|---|---|---|---|---|
| — | `ADVANCE_PENDING` | artisan | `POST /api/artisan/orders` (accept/negotiate) | `advanceDueAmount`, `balanceDueAmount` | "40% advance due — ₹X" panel with a Pay button | "Waiting for the buyer's 40% advance" |
| — | `ADVANCE_WAIVED` | artisan | same, when **no price resolves** | amounts left **null** | no advance panel | production unblocked |
| `ADVANCE_PENDING` | `ADVANCE_INITIATED` | buyer | `POST /api/payments/demand-advance/create-order` | `advanceRazorpayOrderId` | Razorpay modal open | unchanged |
| `ADVANCE_INITIATED` | `ADVANCE_PAID` | buyer, **post-HMAC** | `POST /api/payments/demand-advance/verify` | payment id, signature, `advancePaidAt`, `advanceChargedPaise`, `ArtisanOrder.status → IN_PROGRESS` | settled state + date | "Advance received — you can begin" |
| `ADVANCE_INITIATED` | `ADVANCE_PENDING` | — | **nothing.** A dismissed modal leaves it INITIATED; create-order accepts both states, so retry just makes a new Razorpay order. | Pay button again | unchanged |

`ADVANCE_WAIVED` is **not** a downgrade of `ADVANCE_PAID` and nothing transitions
into it after acceptance. It is set once, at accept time, when there is no price
to take 40% of.

### The production gate

`advanceStatus !== 'ADVANCE_PAID' && advanceStatus !== 'ADVANCE_WAIVED'` → **409**
on:

- `POST /api/artisan/orders/log`
- `PATCH /api/artisan/orders` `action: 'pack' | 'dispatch'`
- `POST /api/artisan/orders/verify-ready`

Message: *"The buyer's 40% advance has not been paid yet. You will be told the
moment it arrives."* The artisan card renders this as a **calm waiting state**,
not a red error — the artisan has done nothing wrong.

`action: 'complete'` is deliberately **not** gated: an order that somehow reached
DISPATCHED must be closable regardless, and gating the final step would strand
rows rather than protect anyone.

### The balance

`/api/buyer/orders/delivered` credits `balanceDueAmount` when
`advanceStatus === 'ADVANCE_PAID'`, and the **full agreed price** when
`ADVANCE_WAIVED` or when the advance was never paid. The existing
`settledAt IS NULL` predicate and `updateMany` concurrency pattern are unchanged.

**Assertion:** `advanceDueAmount + balanceDueAmount === agreed`, to the rupee.
`balanceDueAmount` is computed as `agreed - advanceDueAmount` rather than
`agreed * 0.6`.

> **Corrected during implementation.** This plan originally claimed the two
> roundings "disagree by a rupee on odd prices". They do not: for an integer
> price, `0.4x` can never land exactly on a `.5` boundary, so `round(0.4x)` and
> `round(0.6x)` always complement to `x`. Verified against a sample including
> 3333, 7 and 12345 — all agree. The subtraction is still the right choice, for
> a different reason: it is correct **by construction**, so it cannot drift
> however `advanceFor()` rounds and it stays right if `ADVANCE_RATE` ever
> becomes a figure that does not divide cleanly. The original justification was
> wrong; the decision was not.

---

## F. Threat model

| # | Attack | Mitigation | File |
|---|---|---|---|
| T1 | **CSRF on the OAuth callback** — attacker lures a signed-in victim to a callback URL carrying the attacker's `code`, binding the attacker's Google identity to the victim's session | `state` is server-generated, stored in a signed httpOnly cookie, and must match the query parameter. Cookie is single-use (deleted on read). | `google/start`, `google/callback` |
| T2 | **Authorization-code interception** — code stolen from the redirect (browser history, a malicious extension, a shared referer) | PKCE S256. The code is worthless without the `verifier`, which never leaves the httpOnly cookie. | `src/lib/googleAuth.ts` |
| T3 | **`id_token` forgery** — attacker POSTs a self-signed token | Signature verified against Google's JWKS with `node:crypto`; `iss`, `aud`, `exp`, `nonce` all checked; `email_verified` must be true. | `src/lib/googleAuth.ts` `verifyIdToken()` |
| T4 | **Token replay across apps** — a valid Google token minted for a *different* client | `aud === GOOGLE_CLIENT_ID` is mandatory. | same |
| T5 | **Replayed WebAuthn assertion** | The challenge is single-use (cookie deleted on read) and expires in 5 minutes; `@simplewebauthn/server` verifies the challenge is the one issued. | `passkey/login/verify` |
| T6 | **Cloned authenticator** | Signature-counter regression check, with the both-zero exemption. | `passkey/login/verify` |
| T7 | **Passkey enrolment onto someone else's account** | `userId` comes from the session (or the signed `pending-signup` cookie) and **never from the request body**; the challenge cookie is bound to that `userId` and re-asserted at verify. | `passkey/register/options`, `/verify` |
| T8 | **Forged `payment_id` at the advance-verify route** | `verifyRazorpaySignature()` — HMAC of `<order_id>\|<payment_id>` with the secret, `timingSafeEqual`. Nothing is written before it passes. | `demand-advance/verify` |
| T9 | **Cross-order signature replay** — a signature genuinely valid for order A, POSTed against order B | `razorpay_order_id` must equal the **stored** `advanceRazorpayOrderId` on that `ArtisanOrder`, checked before the HMAC. | same |
| T10 | **Double-payment of one advance** | `updateMany` guarded on `advancePaidAt: null`; a second submit updates 0 rows and returns `alreadyPaid: true`. | same |
| T11 | **Buyer Y pays / settles buyer X's advance** | `Demand.buyerName` compared case-insensitively to the supplied `buyerName` on **both** create-order and verify — the same pattern `/api/buyer/orders/delivered` already uses. | both advance routes |
| T12 | **Artisan self-marks an advance paid** | There is no artisan-reachable route that writes `advanceStatus`. Both advance routes are buyer-scoped and require a Razorpay signature; `requireArtisan()` routes cannot touch these columns. | by construction |
| T13 | **Account enumeration** — probing which emails exist, or which provider they use | Login returns the identical generic `Invalid credentials` 401 for: unknown email, wrong password, **and a null `passwordHash`**. The real reason is logged server-side only. | `auth/login` |
| T14 | **Session fixation after provider switch** | Every successful auth path issues a **fresh** JWT through `issueSession()`; nothing reuses an existing token. | `src/lib/authSession.ts` |
| T15 | **Secret leaking into the browser bundle** | `GOOGLE_CLIENT_SECRET` and `RAZORPAY_KEY_SECRET` are read in server-only modules. The two new `NEXT_PUBLIC_` values are booleans. Verified by grep in PROMPT 3 §E. | — |

### Accepted gaps, stated plainly

- **No rate limiting.** This repo has none today (`grep -rn "rateLimit\|429"` finds
  only Gemini-quota comments), and V10 does not add it. `passkey/login/options`
  and `auth/login` are therefore brute-forceable at whatever rate the host
  allows. On a hackathon deployment behind Vercel/Fly this is mitigated only by
  platform-level limits. **This is a known gap, not an oversight** — a real
  deployment needs per-IP limits on `auth/*` and `demand-advance/*`.
- **`emailVerified` is recorded, not enforced.** Nothing gates on it yet.
- **No CSRF token on same-site POSTs.** The app relies on `sameSite: 'lax'`
  cookies. That is the pre-existing posture for every mutating route in the repo;
  V10 matches it rather than introducing a second, inconsistent scheme.

---

## G. File-by-file work order

### Block 0 — dependencies and schema
| File | Why |
|---|---|
| `package.json` | `@simplewebauthn/server`, `@simplewebauthn/browser`. Nothing else. |
| `prisma/schema.prisma` | §A. Then `db push --url "$DIRECT_URL"` + `generate`. |
| `.env.example` | The eight new variables, in the existing commented style. |

### Block 1 — libraries
| File | Why |
|---|---|
| `src/lib/authSession.ts` **(new)** | `issueSession(user)` + `getSession()`. Pure refactor of what login and register already duplicate — same secret fallback, same 7-day expiry, same cookie flags. |
| `src/lib/registrationRules.ts` **(new)** | The artisan-field validation lifted out of `/api/auth/register` so `/api/auth/google/complete` cannot drift from it. |
| `src/lib/googleAuth.ts` **(new)** | `buildAuthUrl`, `exchangeCode`, `verifyIdToken`, `GOOGLE_CONFIGURED`. JWKS cached in module scope. Typed results, never throws into a route. |
| `src/lib/passkey.ts` **(new)** | The four ceremony helpers, `PASSKEY_CONFIGURED`, the rpID/origin sanity check. |
| `src/lib/razorpay.ts` | `DEMO_CHARGE_PAISE` 100 → 1000; add `DEMO_ADVANCE_PAISE = 400`; rewrite the doc comment. |

### Block 2 — auth routes
| File | Why |
|---|---|
| `src/app/api/auth/login/route.ts` | **The one existing auth file that changes.** Null-hash branch → generic 401. |
| `src/app/api/auth/register/route.ts` | Call the extracted rules + `issueSession()`. Behaviour unchanged. |
| `src/app/api/auth/google/start/route.ts` **(new)** | |
| `src/app/api/auth/google/callback/route.ts` **(new)** | The three-way fork. |
| `src/app/api/auth/google/complete/route.ts` **(new)** | |
| `src/app/api/auth/passkey/register/options\|verify/route.ts` **(new)** | |
| `src/app/api/auth/passkey/login/options\|verify/route.ts` **(new)** | |
| `src/app/api/auth/passkey/route.ts` **(new)** | `GET` list, `DELETE` revoke. |

### Block 3 — advance
| File | Why |
|---|---|
| `src/app/api/artisan/orders/route.ts` | Write the advance ledger in the accept transaction; gate `pack`/`dispatch`. |
| `src/app/api/artisan/orders/log/route.ts` | Production gate. |
| `src/app/api/artisan/orders/verify-ready/route.ts` | Production gate. |
| `src/app/api/payments/demand-advance/create-order/route.ts` **(new)** | |
| `src/app/api/payments/demand-advance/verify/route.ts` **(new)** | |
| `src/app/api/buyer/orders/delivered/route.ts` | Credit the balance, not the full price, when the advance was paid. |

### Block 4 — UI
| File | Why |
|---|---|
| `src/lib/useRazorpayCheckout.ts` **(new)** | Extract the script-load guard + `handler` + failure handling from `ProductClient.tsx` so the advance panel is not a third copy. |
| `src/app/marketplace/product/[id]/ProductClient.tsx` | Use the extracted hook. Behaviour unchanged. |
| `src/app/login/page.tsx` | Divider, Google button (inline SVG), passkey button. Both flag- **and** capability-gated. `?notice=` rendering. |
| `src/app/register/page.tsx` | "Continue with Google" above the untouched form. |
| `src/app/register/complete/page.tsx` **(new)** | Avatar, read-only email, role toggle, artisan fields, optional passkey step with a clear skip. |
| `src/components/ProfileEditorModal.tsx` | Sign-in methods section. Hidden for `PASSWORD` accounts. |
| `src/components/BuyerOrders.tsx` | Advance panel + honest charged-vs-recorded note. |
| `src/app/artisan/orders/page.tsx` | Waiting state on gated cards. |

### Block 5 — the ₹1 sweep and i18n
| File | Why |
|---|---|
| `create-order`, `verify-payment` | Audit-log comment strings. |
| `src/lib/escrow.ts`, `src/lib/razorpayMode.ts`, `ProductClient.tsx`, `buyerNotify.ts`, `buyer/orders`, `demand/track`, `artisan/orders`, `artisan/dashboard` | Doc comments naming ₹1. |
| `src/lib/i18n/{en,hi,or,te}.ts` | The five keys named in §0, **and not `scheme_pm_vishwakarma_benefit`**. Plus every new `auth_*` / `passkey_*` / `advance_*` string in all four. |
| `README.md`, `.env.example`, `docs/*` | Including V9's own docs, which say ₹1 throughout. |

---

## H. Rollback plan

Every change reverts by flipping a flag or deleting a route, without stranding
data.

| Change | Rollback | Data left behind |
|---|---|---|
| Google sign-in | `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` hides the button; unsetting `GOOGLE_CLIENT_ID` makes the routes 503 | `authProvider: 'GOOGLE'` users **cannot sign in** while it is off. This is the one destructive-feeling rollback, and it must be stated in the runbook: turning Google off locks out everyone who signed up with it. |
| Passkeys | `NEXT_PUBLIC_PASSKEY_ENABLED=false` | `Passkey` rows persist and work again when re-enabled. A `PASSKEY`-provider account is locked out meanwhile — same caveat. |
| The advance | Set every `advanceStatus` to `ADVANCE_WAIVED`; the production gate then passes for everyone and `delivered` credits the full agreed price | Paid advances keep their ledger rows; the delivery credit still sums correctly because the balance branch keys off `ADVANCE_PAID`. |
| ₹10 / ₹4 charges | Revert the two constants in `src/lib/razorpay.ts` | `paidAmountPaise` / `advanceChargedPaise` on existing rows record what was *actually* charged at the time. That is history, and it must not be rewritten. |
| Schema | Columns are additive and nullable/defaulted. Reverting the code leaves them unread. | Nothing breaks; `passwordHash` stays nullable, which is harmless. |

**The one-way door:** `passwordHash String` → `String?`. Going back requires
every Google and passkey account to have a password, which they do not. Treat
the nullable column as permanent.

---

## Constraints honoured

- **No `middleware.ts`.** Per-route guards stay the pattern; `getSession()` is a helper, not a gate.
- **Two new dependencies only**, both named in the brief. Google OAuth is hand-rolled on `node:crypto`.
- **Every user-visible string is an i18n key in all four dictionaries** — currently 1090 keys each, verified identical.
- **Existing tokens only.** The Google button is white on `border-gray-200`; the passkey button is `bg-gray-100`; the maroon CTA is untouched. No new colour, radius, shadow or font. Tap targets ≥44px.
- **Honest degradation.** `GOOGLE_CONFIGURED` / `PASSKEY_CONFIGURED` / `RAZORPAY_CONFIGURED` false → the button is absent and the route returns a plain 503. Never a dead button, never a stack trace.
- **No secret gets a `NEXT_PUBLIC_` alias.**
