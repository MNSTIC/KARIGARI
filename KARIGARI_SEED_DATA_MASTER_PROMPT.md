# MASTER PROMPT — Replace the database with 6 high-quality artisans + real imagery, and show the QR-patch photo in View Details

> Paste into **Claude Code** (it has the repo). Two parts: (A) wipe and reseed with realistic, richly-populated data and real per-product images (drafted image + QR-patch verification image), and (B) surface the saved QR-patch photo in "View Details". App root: **`KARIGARI-main/KARIGARI/`** — `cd` there. Next 16, Prisma 7 (`@prisma/adapter-pg`, Postgres), `tsx`. Keep the build green.

**Seeder facts:** the seed is `prisma/seed.ts`, run by `npm run seed` (`tsx prisma/seed.ts`). It already wipes in FK-safe order (`auditLog → notification → demand → schemeApplication → craftItem → artisanProfile → user`) and creates 1 admin + 6 artisans, but every item uses one shared photo and none of the new lifecycle fields — that's why it feels fake. You will rewrite it. Server-side image tooling already present: `sharp`. Add `qrcode` for server QR generation: `npm i -D qrcode @types/qrcode`.

**Schema is already correct — do NOT migrate.** `CraftItem` has: `patchId, status, images[], qrVerified, qrVerifiedImageUrl, qrVerifiedAt, isListedOnMarketplace, isOndcLive, syndicatedChannels[], syndicatedAt, escrowStatus, advanceAmount, finalSettlementAmount, artisanUpiDestination, stripeSessionId, fairWageFloor, marketPriceMin/Max, standardMarketPrice, askingPrice, salePrice, advancePaid, finalPayoutQueued, creditScore, aiGeneratedListing, aiSuggestedCategory, giTagApplied, catalogMethod, voiceLanguage, tags[], descriptionOriginal, descriptionEnglish, rawMaterialCost, laborDays, assignedAdminId, createdAt`. `ArtisanProfile` has `upiId, bankAccountNumber, mobileNumber, socialCategory, gender, annualIncome, aadhaarLast4, clusterName, giTagCertified, giTagName, description, tags[], experienceYears, cooperativeId, photoUrl, healthScore, craftType, location`. Use them all.

---

# PART A — Reseed with real, high-quality data

## A0. Image pipeline FIRST (this is what makes it feel real)
The point of failure today is that all products share `/ikat_saree.jpg`. Build a real, distinct image set under `public/seed/`.

1. **Source real craft photos.** For each of the crafts below, obtain **2–3 genuine, license-free product photos** (Wikimedia Commons direct file URLs or Unsplash/Pexels are fine — CC0/CC-BY). Download them on the user's machine (Claude Code has network), then resize with `sharp` to max 1100px long edge, `image/jpeg` quality ~0.82, and save as `public/seed/<craftSlug>/<n>.jpg`. Crafts to cover (one per artisan, see A2): **Sambalpuri Ikat silk saree** (Odisha), **Pattachitra painting** (Odisha), **Pochampally Ikat** (Telangana), **Blue Pottery** (Jaipur, Rajasthan), **Dhokra brass figurine** (Bastar), **Kutch mirror-work embroidery** (Gujarat). Give each artisan a distinct **portrait** too: reuse `/female_artisan.jpg` only where a woman artisan fits; source 2–3 more free portrait photos (mix of men/women, older/younger) into `public/seed/people/<n>.jpg` so the six look like different real people. 
2. **Robust fallback (must not break the seed):** if any download fails or the network is unavailable, generate a distinct branded placeholder instead — a 1000×750 SVG rasterised by `sharp` to JPEG, tinted in that craft's palette with the craft name and cluster, so every item still has a unique-looking image. Never leave an item pointing at a missing file. Wrap sourcing in try/catch and log which images were real vs generated.
3. **QR-patch verification image (the second image per item).** For every item that is `SELLABLE` or beyond (verified-and-listed / sold), generate the "product photographed with its QR patch" image: take that item's drafted product photo, generate a QR with `qrcode` encoding `${BASE_URL}/verify/${patchId}` (BASE_URL = `process.env.PUBLIC_BASE_URL || 'http://localhost:3000'`), and `sharp`-composite the QR (on a white rounded card, ~24% of width) into the bottom-right corner. Save to `public/seed/verified/<patchId>.jpg`. This is a **real, decodable** QR tied to the patch id, exactly what the attach-verify flow would have produced. Set the item's `qrVerifiedImageUrl` to this path.
4. Reference images as **`/public` file paths** in `images[]` and `qrVerifiedImageUrl` (e.g. `/seed/sambalpuri/1.jpg`) — NOT base64. Static files keep the DB light and every surface fast, and `next/image`/`<img>` render local paths directly (no `next.config` change needed). Add `/seed/**` nothing-special; it's just `public/`.

## A1. Wipe (keep the existing order) then rebuild
Keep the existing `deleteMany` cascade. Password for everyone stays `password123` (bcrypt). Recreate **1 admin** (`admin@karigari.com`, role ADMIN, `patchBankBalance`/`patchBankIssued` realistic) and **6 artisans** below.

## A2. Six unique, fully-populated artisans
Make each a believable real person — unique name, email, mobile (+91, distinct), UPI (`name@okhdfcbank`/`@okaxis`/`@ybl`), a plausible masked bank account, Aadhaar last-4, a 1–2 sentence first-person `description`, 3–5 `tags`, `experienceYears`, `cooperativeId`, real `clusterName`, `giTagCertified`/`giTagName` where the craft has a GI tag, `socialCategory` (spread across SC/ST/OBC/GEN), `gender` (mix), `annualIncome` (below/around the ₹40L exemption, varied), `healthScore` (varied 70–100), and a distinct `photoUrl` from A0. Suggested roster (adjust names/details, keep them consistent and non-duplicated):

| # | Name | Craft | Cluster / State | GI tag | Notes |
|---|------|-------|-----------------|--------|-------|
| 1 | Lakshmi Devi Meher | Sambalpuri Ikat Silk Saree | Bargarh, Odisha | Sambalpuri (yes) | Odia speaker, SHG member, ST |
| 2 | Raghunath Maharana | Pattachitra Painting | Raghurajpur, Odisha | Pattachitra (yes) | master painter, OBC |
| 3 | Anitha Reddy | Pochampally Ikat | Bhoodan Pochampally, Telangana | Pochampally Ikat (yes) | Telugu, women-led, GEN |
| 4 | Imran Khokhar | Blue Pottery | Jaipur, Rajasthan | (none) | Hindi, MSME seller, OBC |
| 5 | Budhram Vishwakarma | Dhokra Brass Figurine | Kondagaon, Bastar (Chhattisgarh) | Bastar Dhokra (yes) | tribal cluster, ST |
| 6 | Jethiben Rabari | Kutch Mirror Embroidery | Bhuj, Kutch (Gujarat) | Kutch embroidery | women artisan, SC |

## A3. Multiple items per artisan spanning EVERY status (so all surfaces are populated)
Give each artisan **4–5 CraftItems** (≈26–30 total) covering the whole lifecycle, so the facilitator queue, nodal analytics, marketplace, and the earnings tracker all show real data. Per artisan include a spread of:
- **`PENDING_VERIFICATION`** — no `patchId`, `isListedOnMarketplace:false`. (Feeds the admin facilitator queue.)
- **`VERIFIED`** — has `patchId` (format `PATCH-<base36ts>-<4digits>`), `qrVerified:false`, `isListedOnMarketplace:false`. (The "awaiting QR upload" state.)
- **`SELLABLE`** — `qrVerified:true`, `qrVerifiedImageUrl` set (A0.3), `patchId` set, not yet listed.
- **Listed + `SOLD_FINAL`** — `isListedOnMarketplace:true`, `isOndcLive:true`, `syndicatedChannels:['KARIGARI_ONDC','ONDC_PAYTM_MAGICPIN', ...]`, `syndicatedAt`, `qrVerified:true` + `qrVerifiedImageUrl`, and full **escrow**: `escrowStatus:'STAGE2_SETTLED_89'`, `stripeSessionId:'cs_test_...'`, `advanceAmount` (≈40% of sale), `finalSettlementAmount` (≈49.36%), `artisanUpiDestination` = that artisan's UPI, `advancePaid`, `finalPayoutQueued`, `salePrice`. (Feeds marketplace + earnings tracker + nodal analytics.)
- At least a couple **listed-but-not-sold** (`SELLABLE`→listed, `isListedOnMarketplace:true`, `escrowStatus:null`) so the marketplace has buyable stock.
- Vary `catalogMethod` (`VOICE`/`MANUAL`/`IVR`) and `voiceLanguage` (Odia/Hindi/Telugu/English) to make the digital-inclusion telemetry real.

For **every** item set self-consistent economics using the real valuation helper: `import { estimateCraftValuation } from '@/lib/pricing'` and derive `fairWageFloor, marketPriceMin, marketPriceMax, standardMarketPrice` from `(craftType, laborDays, rawMaterialCost)`; set `askingPrice` within/just above the band, and `salePrice` = askingPrice for sold items. Fill `descriptionEnglish` (a real 1–2 sentence product description), `descriptionOriginal` (a short line in the artisan's language), `aiGeneratedListing` (a polished ~2-line marketplace blurb), `tags`, `aiSuggestedCategory`, `giTagApplied` (the GI name where applicable), `creditScore`, and a realistic `createdAt` spread across the last ~60 days. `images` = 1–2 real photos for that craft from A0 (vary which photo across an artisan's items so no two look identical).

## A4. Realistic audit trail per item
For each item, write an `AuditLog` chain matching its status, with believable timestamps (ascending, before `createdAt+n`), e.g.:
`ITEM_CAPTURED` (ARTISAN) → `ADMIN_VERIFIED` (ADMIN, records the patchId) → `QR_PATCH_VERIFIED` (ARTISAN/SYSTEM, "physical patch matched to original") → `MULTI_CHANNEL_SYNDICATE` (ARTISAN) → `ESCROW_HELD` (SYSTEM) → `DIRECT_ARTISAN_ADVANCE_PAID` (actorId `SMART_ESCROW_ENGINE`, SYSTEM) → `DIRECT_ARTISAN_FINAL_SETTLEMENT` (SMART_ESCROW_ENGINE). Only include the steps the item has actually reached. This makes the public passport timeline and the admin audit-trace look genuine.

## A5. Keep/upgrade the supporting seeds
Keep the existing **SchemeApplications** (spread statuses across artisans), **Demands** (the buyer board — keep several OPEN + one MATCHED, tied to the real crafts/locations), and **Notifications** (a few DEMAND_ALERT/FESTIVAL/SCHEME per artisan). Make sure names/crafts referenced there match the six artisans above.

## A6. Print a credentials summary at the end
`console.log` a table of all 7 logins (admin + 6 artisans: email / password `password123` / craft) and counts (artisans, items by status, listed, sold), plus how many images were real vs generated fallbacks.

---

# PART B — Show the saved QR-patch photo in "View Details"

The attach-verify flow already saves the artisan's Step-2 "photograph the patched piece" upload to `CraftItem.qrVerifiedImageUrl` and flips the item to `SELLABLE` — but the details view never shows it.

1. **`src/app/api/items/[id]/route.ts`** — add `qrVerified: true` and `qrVerifiedImageUrl: true` to the `select`, and return them: `{ success, images, auditLogs, qrVerified, qrVerifiedImageUrl }`. (Ownership scoping stays as-is: artisan sees only their own; admin sees any.)
2. **`DetailsModal` in `src/app/artisan/dashboard/page.tsx`** — extend the `detail` state type to include `qrVerified` and `qrVerifiedImageUrl`, read them from the fetch, and when `qrVerifiedImageUrl` is present render a **"Verification photo — QR patch attached"** section (below the hero image): the saved photo in a rounded framed container with a small green "Verified authentic" badge, plus the `patchId`. Use `<Image unoptimized={src.startsWith('data:')} …>` (the same pattern the hero image uses) so both data-URL uploads and `/seed/verified/*.jpg` paths render. If `qrVerified` is false, show nothing extra.
3. This must work for both real uploads (data-URL saved by attach-verify) and the seeded `/seed/verified/<patchId>.jpg` paths.

---

## VERIFICATION CHECKLIST
1. `npm i -D qrcode @types/qrcode`, then `npm run seed` completes cleanly and prints the credentials + counts summary; no item points at a missing image.
2. Log in as each of the 6 artisans (`password123`): the dashboard shows their own multiple items with **distinct** product photos and correct statuses; SOLD items show the earnings/escrow figures; the "Live Earnings & Direct UPI Settlement Tracker" shows real advances/settlements to that artisan's UPI.
3. Marketplace (`/marketplace`) shows a varied grid of listed products across all six crafts with real, different images and prices; product pages open with descriptions and the digital passport.
4. Admin (`admin@karigari.com`): facilitator queue shows the `PENDING_VERIFICATION` items across artisans; nodal analytics/dashboard show non-zero sales, advances, and cluster spread; audit-trace shows real timelines.
5. Open a SELLABLE/sold item → "View Details" → the **QR-patch verification photo** is visible with the patch id; the drafted image and the QR-patch image are clearly two different pictures.
6. Run the real QR check: the QR in a `/seed/verified/*.jpg` decodes to `…/verify/<patchId>` (it was generated from the patch id).
7. `npm run build` stays green; theme/responsiveness intact. End with a summary: files changed, images sourced (real vs fallback), item counts by status, and commands run.

### FILE MAP
**Rewrite:** `prisma/seed.ts` (wipe + 6 rich artisans + ~26–30 items across all statuses + audit chains + schemes/demands/notifications + credentials print).
**Create:** `public/seed/<craft>/*.jpg`, `public/seed/people/*.jpg`, `public/seed/verified/<patchId>.jpg` (real photos or generated fallbacks), optionally a small `scripts/build-seed-images.ts` helper the seed calls for downloading/resizing/QR-compositing with `sharp` + `qrcode`.
**Edit:** `src/app/api/items/[id]/route.ts` (return `qrVerified`, `qrVerifiedImageUrl`), `src/app/artisan/dashboard/page.tsx` (DetailsModal shows the QR-patch photo).
**Do not touch:** the schema (no migration), marketplace/escrow/syndication/attach-verify logic, the Groq/Gemini config.
