# KARIGARI — AUTHENTICITY COMPARATOR: BACKGROUND-BLIND FIX

> Single focused Claude Code prompt. Self-contained — run this on its own, independent of the V11 Photo Studio / Shopify prompt (it does not require any V11 code to already exist, though it assumes V11's `originalImageUrl` field if that prompt has already landed — see the fallback note in Step 2).
> Repo root: `KARIGARI/` (the Next.js app).

---

## CONTEXT

KARIGARI lets artisans give a listing photo a swapped backdrop (white studio, cream, gradient, textured surface, or an AI-generated scene) via the photo studio. That is legitimate — the product pixels are never touched, only the background behind them.

But two places in the codebase compare a **live phone photo** against the item's **stored reference photo** using Gemini Vision, to prove the delivered piece is the genuine, fairly-paid-for object: the buyer's delivery-verification check, and (if the V9 demand-sync work has landed) the artisan's own pre-completion "ready" re-verification. A buyer's real-world photo — taken on their table, in their light — will never match a studio backdrop. Today both checks are at risk of a false rejection for the most honest artisans: the ones who used the photo studio to make their listing look good.

The fix has two independent parts, both required:

1. **Compare against the untouched original capture, not the backdrop-swapped display photo.**
2. **Make the comparison prompt background-blind** — instruct the model to judge only the product itself (weave, texture, colour, material, shape, motifs, proportions) and to ignore setting, surface, lighting and staging entirely.

This does **not** relax the separate rule that no AI-generated pixel may ever redraw the product itself (that rule lives in the photo-studio pipeline, not here). This fix only stops a *legitimate* backdrop choice from causing a false rejection at verification time — it does not make the comparator more forgiving about the product itself. If anything, tightening the prompt to focus entirely on product identity should make it *harder* to pass off a genuinely different object.

---

## READ THESE FIRST

- `src/lib/buyerVerify.ts` — `verifyBuyerImage()`, `MIN_SIMILARITY`, `IMAGE_DATA_URL_RE`, the downscale-before-vision step, the Gemini-unconfigured fallback, and the health-score reward logic. This is the buyer's delivery-photo check and/or the scan-anywhere route's comparator.
- `src/app/api/buyer/orders/verify/route.ts` and `src/app/api/buyer/orders/delivered/route.ts` — callers of the comparator; confirm which reference field they currently pass in.
- `prisma/schema.prisma` — check whether `CraftItem.originalImageUrl` already exists (added by the V11 Photo Studio prompt). If it does not exist yet in this codebase, the reference image is `images[0]` today and there is nothing to redirect to yet — in that case, skip Step 2's `originalImageUrl` change, note in the final report that it is a no-op until V11 lands, and apply Step 3 (the prompt rewrite) regardless, since a background-blind prompt is correct even before any backdrop-swap feature exists.
- If a shared "ready verification" comparator exists from the demand-sync (V9) work — search for it (likely near `src/app/api/artisan/orders/` or a shared verify helper) — read it too; the same two fixes apply there.
- `src/lib/gemini.ts` — `GEMINI_CONFIGURED`, `generateContentWithFallback`, existing prompt style and JSON response-schema conventions in this repo, so the rewritten prompt matches house style.

---

## THE PROBLEM, PRECISELY

Both comparators currently do two things wrong for a background-swapped listing photo:

- They read the **display/marketing image** (`images[0]`, which may now be a preset-composited or AI-backdrop frame) as the "ground truth" to diff the buyer's or artisan's live photo against.
- Their comparison prompt asks the model to weigh "weave, texture, colour, and style" without explicitly excluding background — so a studio-white listing photo compared against a phone photo on a cluttered kitchen table can score low on perceived similarity for reasons that have nothing to do with whether it's the same object.

Both failure modes push a genuine, fairly-made item toward a **false rejection** — exactly the artisans this platform exists to protect.

---

## IMPLEMENTATION

### Step 1 — Locate every comparator call site
Grep for every place that calls `verifyBuyerImage()` or an equivalent Gemini-vision product-identity comparison. Confirm the full list before touching anything — this fix must apply everywhere a live photo is diffed against a stored reference, not just the first call site found.

### Step 2 — Point every comparator at the untouched original
At each call site, read `item.originalImageUrl ?? item.images[0]` as the reference image — never the display/marketing frame a background variant may have produced. Do not duplicate this fallback logic inline at each site; add one small shared helper, e.g. `referenceImageFor(item)` in `src/lib/buyerVerify.ts` (or a suitable shared lib if the ready-verification comparator lives elsewhere and would otherwise need its own copy), and have every call site use it. This keeps the two call sites from drifting out of sync later.

If `originalImageUrl` does not exist in this codebase yet (see the read-first note above), this step is a documented no-op for now — leave a comment at the helper noting it will start doing real work once the photo-studio original/variant split lands, and proceed to Step 3 regardless.

### Step 3 — Rewrite the comparison prompt to be background-blind
Replace the existing instruction (something like "analyse weave, texture, colour, and style") with an explicit instruction that:
- States the two photos may have completely different settings, lighting, surfaces and staging, and the model must disregard all of that entirely.
- States the model must judge **only** whether the physical product is the same object: weave/knit pattern, texture, colour, material, shape/silhouette, visible motifs or embellishments, and proportions.
- Includes one worked example anchoring the distinction concretely — e.g., "a studio-lit product photo on a white backdrop compared against a phone photo of the same item on a kitchen table is a match if the product itself is identical; the differing backdrop, lighting and surface are not evidence of a mismatch."
- Makes explicit that this is answering "is this the same physical object," not "was this photographed in the same place" — and that QR/patch-code matching is a separate, already-exact string comparison untouched by this change.

Apply the same rewrite to every comparator identified in Step 1 (buyer delivery check, and the ready-verification comparator if it exists) so the two do not diverge in wording or strictness.

### Step 4 — Preserve every existing guard, unchanged
This is a reference-image and prompt change only. Do not touch: `MIN_SIMILARITY`, the downscale-before-vision step, the Gemini-unconfigured fallback behaviour, or the health-score reward logic in `verifyBuyerImage()`. The plumbing around the comparator is correct today; only what it looks at and how it is instructed should change.

### Step 5 — Confirm the product-authenticity rule is untouched
This fix must not, anywhere, make it easier to pass off a different physical object as genuine. If the photo-studio work (V11) or anything else in this codebase has a rule that no AI-generated pixel may redraw the product itself, confirm that rule is completely independent of this change and still fully enforced — this prompt only fixes the *comparator's* tolerance for background differences, never the *generator's* tolerance for product differences.

---

## VERIFICATION — TRACE, DON'T ASSUME

Walk the actual code paths for each of the following and report what you find, not what you expect to find:

1. **Same product, different background.** An item whose listing photo has a swapped backdrop (studio white, cream, gradient, textured, or AI-generated scene) is compared against a buyer's or artisan's live photo taken in a real, unrelated setting. Confirm: the comparator reads `originalImageUrl` (or the documented `images[0]` fallback) as the reference, the rewritten prompt is the one actually sent to Gemini, and the verdict is a match.
2. **Same background, different product.** Construct the inverse case — two photos with a similar or matching background/setting but a genuinely different product. Confirm the model still correctly reports a mismatch. This is the check that proves the rewritten prompt is actually discriminating on the product and not accidentally rewarding matching backgrounds as a shortcut to "same item."
3. **Gemini unconfigured.** Confirm the existing fallback behaviour is completely unchanged by this fix.
4. **Every call site.** Confirm there is no comparator left anywhere in the codebase still reading the display image or running the old prompt wording — grep and paste the result.
5. **No regression to the product-identity rule.** Confirm nothing in this change weakens detection of an actually-different or AI-synthesised product being passed off as genuine.

## FINAL REPORT
List every file changed, the exact call sites found and fixed, results for all 5 traces above with real evidence (not assumed), and anything left undone with the reason (e.g., `originalImageUrl` not yet present because V11 hasn't landed).
