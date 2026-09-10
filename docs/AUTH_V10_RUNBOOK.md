# V10 Runbook — Google sign-in, passkeys, and the demand advance

Operational procedures. Everything here has a consequence for someone who is
already signed in, so read the caveat before you act.

---

## The one thing to know first

**Turning either feature off locks people out.**

| Flag off | Who cannot sign in |
|---|---|
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` (or `GOOGLE_CLIENT_ID` unset) | Every account with `authProvider = 'GOOGLE'`. They have `passwordHash = NULL` and there is no password-reset flow in this app. |
| `NEXT_PUBLIC_PASSKEY_ENABLED=false` (or `WEBAUTHN_RP_ID` unset) | Every account with `authProvider = 'PASSKEY'`, for the same reason. |

`authProvider = 'PASSWORD'` accounts are unaffected by either flag. That is the
whole point of the V10 design: the password path never changed.

Before flipping either off, check who it strands:

```sql
SELECT "authProvider", count(*) FROM "User" GROUP BY "authProvider";
```

If the count for the provider you are disabling is zero, it is a free action.

---

## Rotate the Google client secret

1. Google Cloud console → **APIs & Services → Credentials** → your OAuth 2.0
   Client ID → **Add secret**. Google allows two live secrets during a rotation,
   so nothing breaks between steps 2 and 4.
2. Set `GOOGLE_CLIENT_SECRET` to the new value in the deployment's environment.
3. Restart. The secret is read at module scope in `src/lib/googleAuth.ts`, so a
   running process keeps the old one until it restarts.
4. Confirm a sign-in works, then **delete the old secret** in the console.

**Do not** change `GOOGLE_CLIENT_ID` during a rotation. It is the `aud` claim
every issued `id_token` is checked against, and changing it invalidates tokens
mid-flight. Rotating the id is a separate, disruptive operation.

**Never** add a `NEXT_PUBLIC_` alias for the secret. Next inlines every
`NEXT_PUBLIC_` value into the browser bundle.

### If the redirect URI is rejected

Google returns `redirect_uri_mismatch` before any of our code runs.
`GOOGLE_REDIRECT_URI` must match the console entry **byte for byte** — scheme,
host, port, path, and no trailing slash. `http://localhost:3000/...` and
`http://localhost:3000/.../` are different URIs to Google.

---

## Revoke a passkey for a locked-out user

A person who lost the device holding their only passkey cannot sign in, and
cannot use the in-app revoke button either — that requires a session.

There is no self-service recovery in this app. The manual procedure:

1. Confirm who you are talking to by some channel other than the account.
2. Find their credentials:

```sql
SELECT p.id, p."deviceLabel", p."createdAt", p."lastUsedAt", u.email, u."authProvider"
FROM "Passkey" p JOIN "User" u ON u.id = p."userId"
WHERE u.email = 'them@example.com';
```

3. Delete the lost one:

```sql
DELETE FROM "Passkey" WHERE id = '<the id>';
```

4. If that was their **last** passkey and `authProvider = 'PASSKEY'`, the
   account now has no way in at all. Either:
   - have them sign in with Google, if `authProvider` was `GOOGLE` and the
     passkey was an addition; or
   - move the account to a password, which is a deliberate downgrade:

```sql
-- Only with the person's knowledge. This gives the account a password path it
-- did not have before, which is a real change to its security posture.
UPDATE "User" SET "authProvider" = 'PASSWORD', "passwordHash" = '<a fresh bcrypt hash>'
WHERE email = 'them@example.com';
```

Generate the hash with `bcrypt.hash(temporaryPassword, 10)` and require a change
on first sign-in — which this app does not enforce, so it is a conversation, not
a mechanism.

### Passkey ceremonies failing silently

Almost always `WEBAUTHN_RP_ID` not matching `WEBAUTHN_ORIGIN`'s hostname. The
browser throws a `SecurityError` that surfaces as "something went wrong", which
reads like a UI bug. `src/lib/passkey.ts` logs a loud warning at import time
when the two disagree — check the server log first.

`WEBAUTHN_RP_ID` is the **bare hostname**: `localhost`, `karigari.app`. No
scheme, no port, no path. `WEBAUTHN_ORIGIN` is the **full origin** including the
port: `http://localhost:3000`.

---

## Turn a feature off

Both are env-only. No code change, no migration, no data loss.

```bash
# Hide the button. Existing sessions stay valid until their 7-day JWT expires.
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
NEXT_PUBLIC_PASSKEY_ENABLED=false

# Also 503 the routes, so a stale client cannot start a ceremony.
GOOGLE_CLIENT_ID=
WEBAUTHN_RP_ID=
```

Rows are untouched. `Passkey` rows survive and work again the moment the flag
comes back. Re-enabling needs no migration.

---

## Turn the advance off

There is no flag for this one; it is a data operation.

```sql
-- Clears the production gate for every live order. Artisans can work again
-- immediately, and delivery credits the FULL agreed price because the balance
-- branch only fires on ADVANCE_PAID.
UPDATE "ArtisanOrder"
SET "advanceStatus" = 'ADVANCE_WAIVED'
WHERE "advanceStatus" IN ('ADVANCE_PENDING', 'ADVANCE_INITIATED');
```

**Do not** touch rows already at `ADVANCE_PAID`. Those have a real gateway
payment behind them, and waiving one would cause the delivery credit to pay the
full price on top of an advance the buyer already paid.

To hide the buyer-facing panel entirely, the same UPDATE is enough:
`AdvancePanel` returns `null` for `ADVANCE_WAIVED`.

---

## Revert the demo charges

`src/lib/razorpay.ts`:

```ts
export const DEMO_CHARGE_PAISE = 1000;  // ₹10 — a full purchase
export const DEMO_ADVANCE_PAISE = 400;  // ₹4  — the 40% advance
```

Changing these affects only **future** orders. `CraftItem.paidAmountPaise` and
`ArtisanOrder.advanceChargedPaise` record what was actually charged at the time.
That is history — do not rewrite it to match a new constant.

To bill the real price instead, see the note in `src/lib/razorpay.ts`. In live
mode that means charging buyers thousands of rupees, so it is a deliberate act.

**Why ₹10 and not ₹1:** 40% of ₹1 is 40 paise, below Razorpay's 100-paise
minimum order amount, so the advance could not be charged at all. ₹10 and ₹4
both clear it.

---

## Known gaps

- **No rate limiting.** `/api/auth/login`, `/api/auth/passkey/login/options` and
  the two advance routes are brute-forceable at whatever rate the host allows.
  This is true of every route in this repo, not just V10's. A real deployment
  needs per-IP limits on `auth/*` and `payments/*`.
- **No account linking.** A Google sign-in on an email that already has a
  password account is refused, by design — auto-linking on a matching email
  means controlling the mailbox is enough to take the account. Linking belongs
  behind an authenticated session and does not exist yet.
- **`emailVerified` is recorded, not enforced.** Nothing gates on it.
- **No payout rail.** `RAZORPAYX_ENABLED=false`. Every artisan settlement,
  advance included, is a recorded programmatic settlement — never a confirmed
  bank credit. Do not let any copy claim otherwise.
