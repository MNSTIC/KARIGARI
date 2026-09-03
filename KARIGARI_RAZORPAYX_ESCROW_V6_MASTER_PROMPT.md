# MASTER PROMPT — KARIGARI RazorpayX Escrow+ / UPI Payout Integration V6

> Paste into **Claude Code** (it has this repo). Integrate **RazorpayX Escrow+ / Route** UPI payouts on top of the existing Razorpay Checkout collection, so the two escrow tranches (40% on dispatch, ~49.36% on delivery) can disburse to the artisan's UPI VPA — **with a real RazorpayX code path guarded behind config, degrading to the existing simulated settlement** in test/sandbox. **Do NOT blindly paste the two snippets the user supplied — they duplicate existing routes and the settle version is unsafe. Reconcile them into the existing engine as directed below, then run the verification pass in §V.** Work only inside the app root. Keep theme, i18n, build green.

---

## 0. ORIENTATION (read first)

**App root:** `KARIGARI-main/KARIGARI/` — `cd` there. Next.js **16.3.1** (Turbopack), React 19.2, TS 5, Prisma 7.9 + `@prisma/adapter-pg` (Postgres). Route handlers: `src/app/api/**/route.ts`, `export async function POST(req: Request)`, `export const dynamic = 'force-dynamic'`.

**Depends on V5 (Razorpay Checkout) being in place.** V5 added: `src/lib/razorpay.ts` (`RAZORPAY_KEY_ID`, `razorpay` client, `RAZORPAY_CONFIGURED`, `verifyRazorpaySignature`, `DEMO_CHARGE_PAISE = 100`), the create-order route, `verify-payment` route, and Razorpay env vars. If V5 is not yet applied, apply it first (or tell the user). **The ₹1 demo-charge rule from V5 still holds: collection charges ₹1; all displayed/ledger amounts stay the real listing price.**

**The existing settlement engine — reuse it, do not replace it:** `src/app/api/payments/settle-escrow/route.ts` is already a robust, idempotent, `$transaction`-safe two-tranche state machine. Study it. It:
- Loads the `CraftItem`, checks `escrowStatus` (`ESCROW_HELD → STAGE1_ADVANCE_PAID_40 → STAGE2_SETTLED_89` from `@/lib/escrow`), and is **idempotent** (re-firing never double-pays).
- `DISPATCH`: releases `advanceFor(price)` (40%), sets `escrowStatus`, `advancePaid`, `status='ADVANCE_PAID'`, writes an audit row **inside the same `$transaction`**.
- `DELIVERED`: releases `finalSettlementFor(price)` (~49.36%), computes `platformFeeFor`, pays the affiliate `creatorCommissionFor` to the creator's own VPA, sets `status='SOLD_FINAL'`, all in one transaction.
- Money to `artisanUpiDestination` (the artisan VPA snapshotted at checkout). No admin/facilitator has financial authority — do not add an approval gate.

**Escrow constants** (`src/lib/escrow.ts`): `ADVANCE_RATE 0.4`, `FINAL_SETTLEMENT_RATE 0.4936`, `PLATFORM_FEE_RATE 0.035`, `CREATOR_RATE 0.05`, `advanceFor`, `finalSettlementFor`, `platformFeeFor`, `creatorCommissionFor`, `rupees`, `ESCROW_HELD`, `STAGE1_ADVANCE_PAID_40`, `STAGE2_SETTLED_89`. **Never hardcode 0.40/0.4936** — use these.

**AuditLog model** (`prisma/schema.prisma`): `craftItemId` is **required and FK-bound** to `CraftItem`; fields `actorId?`, `actorRole` (required), `action` (required), `previousState? Json`, `newState? Json`, `comments?`. So `auditLog.create` **fails** if `craftItemId` is missing or references a non-existent item — always validate the item exists first. `logCraftItemEvent(...)` from `@/lib/auditLogger` is the helper.

**Conventions:** Prisma singleton `@/lib/prisma`. Money via `@/lib/pricing`/`@/lib/escrow`. No new deps beyond `razorpay` (already added in V5). Secrets server-only, never `NEXT_PUBLIC_`. Run `npx prisma generate` + a migration after schema edits.

---

## 1. REVIEW OF THE SUPPLIED CODE — what's wrong, what to keep

The user pasted two files. **Do not add them verbatim.** Problems to fix while integrating:

**Snippet A — `.../razorpay/create-order/route.ts` (order with escrow-hold notes):**
- ❌ Duplicates V5's create-order → two competing order routes. **Do not create a second route.** Instead, fold its one useful idea — the escrow-hold `notes` — into the **existing** create-order.
- ❌ Fallback creds `"rzp_test_demo"/"demo_secret"` — remove; use the `razorpay` client + `RAZORPAY_CONFIGURED` from `src/lib/razorpay.ts`.
- ❌ `amount * 100` charges the real price — violates the ₹1 demo rule. Use `DEMO_CHARGE_PAISE`.
- ❌ `craftItemId.slice(0, 8)` throws when `craftItemId` is undefined — validate first (V5 already does).
- ❌ `catch (error: any)` — repo prefers typed handling; use `unknown` + a message extractor.
- ✅ Keep: adding `notes: { craftItemId, artisanId, escrowStage: "HELD_IN_NODAL_ESCROW" }` to the Razorpay order.

**Snippet B — `.../razorpay/settle-escrow/route.ts` (staged disbursement):**
- ❌ Duplicates the existing, superior `settle-escrow`. **Do not create a second settle route.**
- ❌ No idempotency and no `escrowStatus` state check → can double-pay on re-fire.
- ❌ Hardcodes `0.40` / `0.4936` instead of `advanceFor`/`finalSettlementFor`.
- ❌ Only writes an `auditLog` row; never updates the `CraftItem` ledger (`escrowStatus`, `advancePaid`, `finalPayoutQueued`, `status`) — the item never actually advances stage.
- ❌ No `$transaction`: the audit row can persist without the item update (or vice-versa).
- ❌ **Missing return** when `action` is neither `DISPATCH` nor `DELIVERED` → handler returns `undefined` → runtime error. No `try/catch`.
- ❌ No creator/affiliate commission (the existing route pays it).
- ✅ Keep the *intent*: at DISPATCH pay 40% to artisan VPA, at DELIVERED pay the remainder — which the existing route already does correctly. The genuinely new ask is **making the payout real via RazorpayX** rather than only a ledger record.

**Conclusion:** the new value to add is a **RazorpayX payout layer**, wired into the existing `settle-escrow` engine — not two new routes.

---

## 2. WHAT TO ACTUALLY BUILD

### 2.1 Reality check on RazorpayX Escrow+ / Route (put this honestly in code comments + the user report)
RazorpayX **Escrow+ / Route** and **Payouts** require an **activated RazorpayX account** with KYC, a funding account, and (for Route) linked sub-accounts, or (for Payouts) a fund account of type `vpa`. The shared **test key** `rzp_test_...` used for Checkout **cannot** perform real UPI payouts to arbitrary VPAs. So:
- **Collection (UPI in):** works today via Razorpay Checkout — UPI is an available method; funds collect into the platform account. Ensure UPI is offered/eligible in the modal.
- **Payout (UPI out to artisan):** wire the **real RazorpayX call behind a config flag**, and **degrade to the existing simulated settlement record** when the flag/keys are absent (which is the default for this demo). This keeps the state machine, ledger and audit trail real while being honest that the bank credit is simulated in sandbox.

### 2.2 New payout helper — `src/lib/razorpayPayout.ts`
Create a server-only module:
- `export const RAZORPAYX_ENABLED = <bool>` — true only when `RAZORPAYX_ENABLED === 'true'` **and** the RazorpayX creds exist (`RAZORPAYX_KEY_ID`/`RAZORPAYX_KEY_SECRET`, or reuse `RAZORPAY_KEY_ID/SECRET` if you prefer a single account — document which). Default **false**.
- `export interface PayoutResult { mode: 'RAZORPAYX' | 'SIMULATED'; reference: string; vpa: string; amount: number; raw?: unknown }`.
- `export async function payoutToVpa({ amount, vpa, purpose, referenceId, notes }): Promise<PayoutResult>`:
  - When `RAZORPAYX_ENABLED`: call the RazorpayX **Payouts** API (`POST https://api.razorpay.com/v1/payouts`, or Route `transfers`) with a `vpa` fund account, `amount` in paise, `currency: 'INR'`, `mode: 'UPI'`, `purpose`, an **idempotency key** (`referenceId`, via the `X-Payout-Idempotency` header) so retries never double-pay. Return `{ mode: 'RAZORPAYX', reference: payout.id, ... }`. On API error, throw a typed error the caller records as a failure (do NOT mark the tranche paid on a failed payout).
  - Otherwise: return `{ mode: 'SIMULATED', reference: 'SIM_' + referenceId, vpa, amount }` — no network call. This is the demo default.
- No React/Prisma imports. Secrets from env only.

### 2.3 Wire the payout into the EXISTING `settle-escrow` route (do not fork it)
In `src/app/api/payments/settle-escrow/route.ts`:
- At **DISPATCH**, before/within the `$transaction`, call `payoutToVpa({ amount: advance, vpa: destination, purpose: 'payout', referenceId: \`${item.id}-STAGE1\` })`. Record `payoutMode` and `payoutRef` on the item and in the audit `newState`. If the real payout **throws**, return 502 and do **not** flip `escrowStatus`/`status` (keep it re-fireable). In SIMULATED mode it always "succeeds" as today.
- At **DELIVERED**, same for the `final` tranche (`referenceId: \`${item.id}-STAGE2\``) and, when an affiliate exists, a third payout to the creator VPA (`referenceId: \`${item.id}-CREATOR\``). Keep all ledger writes + audit rows in the one `$transaction`; perform the network payout call **before** committing the transaction, and only commit if the payout resolved (or SIMULATED). Preserve idempotency: an item already at `STAGE1_ADVANCE_PAID_40`/`STAGE2_SETTLED_89` returns the recorded tranche without paying again.
- Update the audit comments/actor to reflect the mode, e.g. actorRole stays `SYSTEM`, action unchanged, comment: `... via RazorpayX Payout <ref>` or `... simulated settlement (RazorpayX not enabled) ...`. Keep the existing "no admin approved this" governance framing.
- Rename nothing the frontend depends on. The response can add `payoutMode` and `payoutRef` fields.

### 2.4 Fold the escrow-hold marker into the existing create-order
In V5's create-order route, add to the Razorpay `orders.create({ ... notes })`: `escrowStage: 'HELD_IN_NODAL_ESCROW'` alongside the existing `craftItemId`, `artisanId`, `displayPrice`, `ref`. No behaviour change; it just tags the order as an escrow hold. Keep `amount: DEMO_CHARGE_PAISE` (₹1).

### 2.5 UPI collection in the modal
Ensure the Razorpay Checkout modal (V5, in `ProductClient.tsx`) surfaces **UPI** as a method (it's default-enabled; optionally pass a `config.display` / `method: { upi: true }` block to feature it). Add a small "Escrow-protected · funds held until dispatch" note near the Buy button (themed, i18n) so the escrow story is visible to the buyer.

### 2.6 Schema additions (`model CraftItem`)
Add (nullable, non-breaking):
```prisma
payoutMode        String?   // RAZORPAYX | SIMULATED
stage1PayoutRef   String?
stage2PayoutRef   String?
creatorPayoutRef  String?
```
Migrate + `prisma generate`. (Do not add tables you don't need.)

### 2.7 Env (`.env` + `.env.example`, secrets server-only)
```
# RazorpayX payouts (leave disabled for the demo → simulated settlement)
RAZORPAYX_ENABLED=false
RAZORPAYX_KEY_ID=
RAZORPAYX_KEY_SECRET=
RAZORPAYX_ACCOUNT_NUMBER=      # RazorpayX virtual account for Payouts, when enabled
```
Put placeholders in `.env.example`. `.gitignore` already ignores `.env*` and keeps `!.env.example` — verify. Never expose any secret via `NEXT_PUBLIC_`.

---

## §V — VERIFICATION PASS (run after implementing; fix every error before reporting done)

1. **Build & lint:** `npm run build` (Turbopack) zero TS errors; `npm run lint` clean (no `any` in the new code, no unused imports). `npx prisma generate` clean; migration applied.
2. **No duplicate routes:** there is exactly **one** create-order route and **one** `settle-escrow` route. The two supplied snippets were folded in, not added. Grep for `razorpay/create-order` and `razorpay/settle-escrow` to confirm no stray duplicates exist.
3. **Idempotency preserved:** fire `settle-escrow` `DISPATCH` twice → second call returns `idempotent:true`, no second payout, no second ledger change. Same for `DELIVERED`.
4. **Simulated default:** with `RAZORPAYX_ENABLED=false`, DISPATCH/DELIVERED still advance the state machine, write audit rows with `payoutMode: 'SIMULATED'`, and never hit the network. Artisan earnings/escrow figures still show the real display price (not ₹1).
5. **Real-path safety (no live account needed to verify the guard):** with the flag on but bad/empty RazorpayX creds, a payout attempt **fails cleanly** (502), and the tranche is **not** marked paid (still re-fireable) — confirm the item's `escrowStatus` did not advance on failure.
6. **Secret hygiene:** grep client bundle/components — no `RAZORPAYX_KEY_SECRET`/`RAZORPAY_KEY_SECRET` anywhere client-side.
7. **Collection smoke (`npm run dev`):** Buy → modal shows UPI as a method and charges ₹1; verify-payment marks the item paid (V5). Then POST `settle-escrow` `DISPATCH` then `DELIVERED` (e.g. via the admin/logistics trigger or curl) → stages advance, audit trail shows the payout mode + refs.
8. **Report:** list files created/modified; state plainly that (a) collection is real via Checkout, (b) payouts are **simulated by default** because RazorpayX Escrow+/Route/Payouts needs an activated KYC'd RazorpayX account and cannot run on the shared test key, and (c) the exact env flag + helper (`src/lib/razorpayPayout.ts`) to flip on real payouts later. Note the RazorpayX docs: https://razorpay.com/docs/razorpayx/ and Payouts API https://razorpay.com/docs/api/x/payouts/ . If `npm`/network is unavailable in the environment, say so rather than faking anything.

**Governance reminder for the implementer:** do not add an admin/facilitator approval gate on `settle-escrow` — the non-custodial, no-human-authority design is deliberate. The payout destination is always the artisan's own snapshotted VPA; no code path may let a caller redirect it.
