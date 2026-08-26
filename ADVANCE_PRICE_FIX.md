# MASTER PROMPT — Fix "phantom advance" + add artisan price-setting (make the money flow truthful & dynamic)

> Paste this whole file into Claude Code. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there; `npm install`; after `prisma generate`, restart `npm run dev`). Theme in `src/app/globals.css` (primary `#24332C`, bg `#FCF8F7`, mint `#DCEBE0`); keep `useLanguage` i18n; Next 16 (`await cookies()`). Verify in the running app, not by code inspection.

There are two linked problems, both confirmed in the code:

---

## PROBLEM 1 — A "PENDING VERIFICATION" item shows a fake "Advance Received" (₹15,675)

### Root cause (confirmed)
An item the artisan just listed has `status = PENDING_VERIFICATION` and `advancePaid = 0` (no advance is paid until it's verified AND the artisan claims it). But the UI shows the item's **AI valuation** (`fairWageFloor`) in the "Advance Received" box because of a fallback. In `src/app/artisan/dashboard/page.tsx` **line 410** (inside `DetailsModal`):
```tsx
₹{item.advancePaid > 0 ? item.advancePaid.toLocaleString() : (item.fairWageFloor?.toLocaleString() || 0)}
```
`₹15,675` is exactly this item's `fairWageFloor` (15 labor days × ₹650 silk + ₹4,500 material + 10% overhead), and `₹18,810–₹25,080` is its `marketPriceMin–Max`. So the box is mislabeled AI math as a received advance. An advance can only exist after verification, so this is logically impossible and must read **₹0** until a real advance is disbursed.

The same "show `fairWageFloor` when no real advance exists" fallback repeats elsewhere and must all be corrected to use the **actual `advancePaid`**:
- `src/app/artisan/dashboard/page.tsx:410` — DetailsModal "ADVANCE RECEIVED" (primary bug in the screenshot).
- `src/app/api/artisan/dashboard/route.ts:74` and `:77` — `totalAdvances` / `pastWeekAdvances` do `item.advancePaid || item.fairWageFloor || 0`. Use `item.advancePaid || 0` only. (These queries are already filtered to `ADVANCE_PAID`/`SOLD_FINAL`, so real advances still count; the floor fallback just fabricated numbers when `advancePaid` was 0.)
- `src/app/verify/[patchId]/VerificationClient.tsx:119` — "Artisan Received" `item.advancePaid || item.fairWageFloor || 5000`; and `:114` `item.fairWageFloor || 5000`. Drop the hardcoded `5000` and the floor fallback; show the real `advancePaid` (plus `finalPayoutQueued` where relevant). If truly unknown, show "—", never an invented number.
- `src/app/api/admin/dashboard/route.ts:101` — leaderboard earnings `ci.advancePaid || ci.fairWageFloor || 0`. Use real `advancePaid` (+ `finalPayoutQueued`).

`src/app/api/disbursement/apply/route.ts:59` sets `advancePaid = item.fairWageFloor` when the artisan chooses `KARIGARI_ADVANCE` — that is the ONE correct place an advance becomes real (on claim, after verification). **Keep it.** Do not confuse this with the display fallbacks above.

### What to build — a truthful, status-aware money box
In `DetailsModal` (and anywhere the item's advance is shown), drive the label + value off `status`:
- `PENDING_VERIFICATION`: **Advance Received = ₹0.** Show a muted helper: "Eligible advance ₹{fairWageFloor} — released after admin verification." (Make clear it is an estimate, not received.)
- `VERIFIED` (admin approved, `patchId` minted, not yet claimed): **Advance Received = ₹0**, helper "Verified — claim your advance to receive ₹{fairWageFloor}."
- `ADVANCE_PAID`: **Advance Received = ₹{advancePaid}** (the real value).
- `SOLD_FINAL` / `PAYOUT_COMPLETED`: show real `advancePaid` + `finalPayoutQueued` (total earned).
Keep it dynamic from the item's real fields — no hardcoded fallbacks, no `NaN`. Add/scope any new strings through `useLanguage`.

---

## PROBLEM 2 — The artisan can't set a price. Add price-setting to Capture Step 3.

### Current state (confirmed)
`src/components/CaptureModal.tsx` Step 3 (lines **714–729**) is only a "Raw Material Proof" upload. `handleSaveUpload` (lines **133–171**) POSTs to `/api/items/capture` **without any price** (payload lines 146–155). `src/app/api/items/capture/route.ts` computes `fairWageFloor`/`marketPrice*` from labor+material and never receives an artisan price. So the artisan never chooses what to sell for.

### What to build
1. **Schema** (`prisma/schema.prisma`, `CraftItem`): add `askingPrice Float?` (the artisan's chosen listing price). Run `npx prisma db push && npx prisma generate`, then restart the dev server.
2. **Capture Step 3 UI** (`CaptureModal.tsx`, in the `step === 3` block ~714): add a **"Set your price"** section above the raw-material upload:
   - Show the AI-suggested guidance so the artisan isn't guessing. Compute a client-side estimate from the values already in state (`laborDays`, `rawMaterialCost`) using the same formula as the API (`labor×baseWage + material + 10%` for the floor; `×1.2`–`×1.6` for the market band) so you can render "AI suggests ₹X–₹Y (fair floor ₹Z)". A number input (`askingPrice` state) prefilled with the suggested market-mid.
   - Warn inline (do not block) if the entered price is **below the fair floor** ("This is below the AI fair-wage floor — buyers may be under-paying you"). This is the artisan-facing side of the anti-exploitation guardian.
3. **Send it** (`handleSaveUpload`, payload ~146–155): add `askingPrice: Number(askingPrice) || null`.
4. **Persist + flag** (`src/app/api/items/capture/route.ts`): accept `askingPrice`; save it on the `craftItem.create` (~105–126). If `askingPrice` is set and `< fairWageFloor * 0.7`, also set `pricingFlag: true` and `flagReason: "Artisan set price {askingPrice}, {pct}% below AI fair-wage floor {fairWageFloor}"` (this feeds the admin facilitator anti-exploitation queue, which already reads `pricingFlag`). Log it via `logCraftItemEvent`. Default `askingPrice` to `standardMarketPrice` when the artisan leaves it blank.
5. **Use the artisan's price as the listing price** everywhere a price is displayed/broadcast, falling back for legacy rows: `askingPrice ?? standardMarketPrice ?? fairWageFloor`. Update at least: the marketplace listings (`src/app/artisan/market/page.tsx` + `src/app/api/artisan/listings/route.ts`, add `askingPrice` to the select), the ONDC catalog serializer (`/api/ondc/catalog` — use `askingPrice` for `price.value`), and the digital passport if it shows a price. Show the artisan's set price in the DetailsModal too (a "Your listing price" row).

---

## GUARDRAILS
- **No fabricated money anywhere.** Advance = real `advancePaid`; listing price = artisan's `askingPrice` (with the documented fallback for old rows). Never display `fairWageFloor` as if it were an advance or a received amount.
- Keep the legitimate advance-on-claim logic in `disbursement/apply` intact.
- Theme tokens + `useLanguage` for new UI; no `NaN`/hardcoded numbers.
- `npx tsc --noEmit && npm run build` must pass; fix anything you introduce.

## VERIFICATION (run the app; report results)
1. List a NEW craft via Capture. In **Step 3**, set a price — confirm the AI-suggested band shows and a below-floor warning appears if you underprice.
2. Open the new item's **Transaction Details**: status is `PENDING VERIFICATION` and **Advance Received shows ₹0** (with the "eligible after verification" helper) — NOT the AI valuation. Your set listing price is shown.
3. Have an admin verify it, then claim the advance (Sell/disbursement): now **Advance Received shows the real amount**.
4. Set a price below 70% of the fair floor and confirm the item appears **flagged** in the admin facilitator pricing queue.
5. Confirm the marketplace card, ONDC catalog JSON, and passport all show the artisan's set price. Report changed files + the schema migration.
