# V11 Runbook — Photo Studio and Shopify artisan shops

Procedures for operating what V11 added. Design and reasoning live in
`docs/PHOTO_STUDIO_SHOPIFY_V11_PLAN.md`; endpoint contracts in `docs/CONTRACT.md`.

---

## 1. Shopify

### 1.1 First connection

1. Fill the Shopify block in `.env` (see `.env.example` and README → V11) and
   restart the server — `SHOPIFY_CONFIGURED` is read at startup.
2. Sign in as an ADMIN and run the probe:

   ```bash
   curl -X POST https://<host>/api/artisan/shopify/test -H "cookie: auth-token=<admin session>"
   ```

   `ok: true` means: token accepted, currency INR, every required scope granted,
   Online Store channel present. `problems[]` names anything that is not;
   `warnings[]` flags a missing `SHOPIFY_LOCATION_ID`.
3. **Watch the first real publish.** The Shopify client was verified against a
   stateful fake of the Admin API, not a real store. After the first
   "Publish to my shop", open the product in Shopify admin and check: title,
   vendor = the artisan, price in rupees equal to the Karigari listing price,
   the chosen photo, membership of the artisan's collection, and that the
   collection page (`/collections/karigari-…`) loads.

### 1.2 Rotating the Admin API token

Custom-app tokens do not expire on a schedule. Rotate when one may have leaked,
or when someone with access leaves.

1. Shopify admin → Settings → Apps and sales channels → Develop apps → the
   Karigari app → **API credentials** → **Rotate** (or uninstall and reinstall,
   which issues a new token and revokes the old one).
2. Put the new token in `SHOPIFY_ADMIN_ACCESS_TOKEN` in the host's environment
   (Vercel: Settings → Environment Variables). **Never** as a `NEXT_PUBLIC_`
   variable.
3. Redeploy / restart. Until then the old token returns 401 and every publish
   fails with *"The platform's Shopify connection has been disconnected."* —
   products already live stay live.
4. Run the probe (1.1 step 2). Then retry anything that failed in the window
   (1.4).

### 1.3 A publish stuck in `PUBLISHING`

`PUBLISHING` is a claim written before any Shopify call. A request that died
(a killed function, a deploy mid-request) leaves it behind.

- **It recovers on its own.** After 3 minutes the artisan's card shows it as
  interrupted with a Retry button, and the publish route takes the stale claim
  over. No action is needed unless you want it sooner.
- **To release it now**, only when you are sure no request is still running:

  ```sql
  UPDATE "CraftItem"
     SET "shopifyStatus" = 'FAILED',
         "shopifySyncError" = 'Publishing was interrupted. Retry to finish.',
         "shopifyStatusAt" = now()
   WHERE id = '<craftItemId>' AND "shopifyStatus" = 'PUBLISHING';
  ```

- **Why a retry is safe.** `productSet` upserts by the piece's deterministic
  handle, so re-running after a crash updates the product that may already exist
  rather than creating a second one.

A shop stuck in `ShopifyShop.status = 'CREATING'` recovers the same way after
90 seconds; `FAILED` shops are retried automatically on the next publish.

### 1.4 Re-running failed publishes in bulk

After an outage, a token rotation or a scope fix:

```bash
npx tsx --env-file=.env scripts/shopify-retry-failed.ts                        # dry run
npx tsx --env-file=.env scripts/shopify-retry-failed.ts --apply --base https://<host>
```

It lists every `FAILED` row and every `PUBLISHING` claim older than 3 minutes,
then replays each through `POST /api/artisan/shopify/publish` as its artisan —
the same claim, refusals, bookkeeping and audit row as a click. Serial with a
pause, so it does not trip the rate limit itself. It never touches `LIVE` or
`WITHDRAWN`. Run it as an operator: it signs short sessions with `JWT_SECRET`.

To see what failed and why first:

```sql
SELECT id, "craftType", "shopifyStatus", "shopifySyncError", "shopifyStatusAt"
  FROM "CraftItem"
 WHERE "shopifyStatus" IN ('FAILED', 'PUBLISHING')
 ORDER BY "shopifyStatusAt";
```

### 1.5 Failure messages and what to do

| Artisan sees | Cause | Fix |
|---|---|---|
| "…connection has been disconnected…" | 401: token revoked or wrong | Rotate / correct the token (1.2) |
| "…missing a permission (write_products)…" | scope not granted | Grant it on the custom app, reinstall if Shopify asks, re-probe |
| "Shopify is busy right now…" | throttled after 3 backed-off attempts | Wait a minute; bulk retry later (1.4) |
| "Shopify refused this listing: …" | a `userError` on the mutation | Read the message — usually listing data (title length, price) |
| "The Shopify store's currency is USD…" | store not in INR | Settings → General → Store currency → INR |
| "…has no Online Store sales channel…" | channel removed | Add the Online Store channel back |
| "The product was created but is not on your shop page yet…" | product written, publishing to Online Store refused | Fix the cause, then Retry — it resumes on the same product |
| "This piece sold on Karigari but is still on your Shopify shop…" | the post-sale withdraw was refused | Set the product to Draft in Shopify admin; check the token and scopes |

### 1.6 Sales on either side

- **Sold on Karigari** (Razorpay verify-payment, admin simulate-sale): the
  Shopify product is set to **Draft** right after the sale commits, and the row
  becomes `WITHDRAWN`. Other ways a row reaches `SOLD_FINAL` (buyer
  authentication, escrow settlement) happen only after a payment, which already
  withdrew it.
- **Sold on Shopify**: fulfilled from Shopify admin. It does **not** enter
  Karigari's escrow or the artisan's earnings. With `SHOPIFY_LOCATION_ID` set,
  the piece's stock goes to 0 and Shopify stops selling it; without it, Shopify
  does not track stock. In both cases mark the Karigari listing unavailable by
  hand, or the piece can be bought twice.

### 1.7 Turning Shopify off

- `NEXT_PUBLIC_SHOPIFY_ENABLED=false` hides the card. Unsetting any of domain,
  token or version makes every Shopify route answer 503.
- **Neither unpublishes anything.** Products already live stay on the storefront.
  To take them down: Shopify admin → Products → filter vendor or tag `Karigari` →
  select all → **Set as draft**.
- No data is lost: `ShopifyShop` rows and the Shopify columns stay, and turning
  it back on resumes from them.

---

## 2. Photo Studio

### 2.1 Switches

| Variable | Effect when off |
|---|---|
| `NEXT_PUBLIC_PHOTO_STUDIO_ENABLED` | Capture runs the pre-V11 path: one auto-enhanced frame, no gallery, no retake prompt. New rows leave the studio columns null; buyer checks fall back to `images[0]`. Rebuild required (it is a `NEXT_PUBLIC_` variable). |
| `SERVER_CUTOUT_ENABLED` (default **off**) | Phones without WebGPU keep their background; the gallery offers Original and Enhanced. |

### 2.2 Before enabling the server cutout

- **Licence.** `@imgly/background-removal-node` is **AGPL-3.0**. Serving it over a
  network engages the network-use clause: users can be entitled to the source.
  Fine for an open demo; a real obligation for a closed product.
- **Size.** On Linux x64 the function traces to **~124 MB** (84 MB model,
  19 MB ONNX runtime, 18 MB libvips) against Vercel's 250 MB limit.
  `next.config.ts` adds the model chunks and `libonnxruntime.so` that static
  tracing misses — without them the route deploys and fails on every call.
- **Measuring.** Build on Linux (or in the deploy) and sum
  `.next/server/app/api/items/background/route.js.nft.json`. A **Windows** build
  over-reports (~179 MB): Next 16.3 does not apply `outputFileTracingExcludes`
  on Windows paths, so the macOS/Windows ONNX binaries stay in the local trace.
- **Load.** At most 2 cutouts run at once and 1 per artisan; each is capped at
  2 MB in, 20 s wall time. Measured 2–5 s per photo warm.

### 2.3 "The chosen look could not be matched to the camera frame…"

This note on a capture means the server replaced the artisan's chosen look with
the camera frame (`src/lib/lookProvenance.ts`). Causes, most likely first:

1. The cutout was over 700 KB and dropped, so there was nothing to prove a studio
   look against. The client shrinks cutouts to fit (WebP with alpha); an old
   client or a very large piece can still exceed it.
2. The look genuinely was not the frame — a tampered request.

The artisan can re-pick a look on `/artisan/market`, which re-runs the same
check. The listing is never left without a photo.

### 2.4 Generated backdrops never appear

Expected on a free-tier Gemini key: image models report `limit: 0`. The client
learns this from the first `no_quota` answer and stops asking for the rest of
the session. A billed key with image quota enables it with no code change.

### 2.5 Gemini unavailable during capture

Artisans see "Photo check unavailable" and carry on. The capture stores
`photoQualitySource = HEURISTIC` (the on-phone check ran) or `UNCHECKED`, with
no score, and nothing on screen claims an AI check happened. The admin
verification queue sees the note.
