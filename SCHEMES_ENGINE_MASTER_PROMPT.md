# MASTER PROMPT — KARIGARI Government Scheme Eligibility Engine (`/artisan/schemes`)

> Paste this whole file into Claude Code as your task. It is self-contained. Follow it top to bottom.

---

## 0. ROLE & MISSION

You are a principal full-stack engineer on **KARIGARI** (SIH 2026, MoSJE PS 26090 — AI fairness protocol for handloom/handicraft artisans). Your mission: **rebuild the artisan "Government Schemes" tab into a real, dynamic Government Scheme Eligibility Engine.**

> **Definition (the target):** A **rules engine (not a black-box model)** evaluates the artisan's stored profile against **published eligibility criteria** for **PM Vishwakarma, NSFDC, NBCFDC, GeM seller status, AHVY cluster support, and ONDC listing**, and renders **eligible / ineligible cards** with a **direct-apply or download-form action**, plus **status tracking (ELIGIBLE → APPLIED → APPROVED)**.

Quality bar: **real published criteria, real government portal links, eligibility computed from the artisan's actual DB profile, and honestly persisted status.** No faked submissions, no eligibility that ignores the data. This is government-facing software judged live.

---

## 1. WHERE THE CODE IS (nested folder)

The app root is **`KARIGARI-main/KARIGARI/`** (one level below the connected folder). `cd` there and run all commands there.

```
KARIGARI/
  prisma/schema.prisma          # SchemeApplication model lives here
  prisma/seed.ts                # seed demo applications here
  src/app/artisan/schemes/page.tsx        # ★ THE PAGE YOU REBUILD
  src/app/artisan/dashboard/page.tsx      # artisan design language to match
  src/app/api/artisan/dashboard/route.ts  # how the page currently gets profile+applications
  src/components/ProfileEditorModal.tsx   # where artisans edit profile (socialCategory capture)
  src/components/ui/KarigariLogo.tsx
  src/lib/translations.ts       # i18n (useLanguage) — the page is multilingual
  src/lib/prisma.ts             # prisma client singleton (@/lib/prisma)
```

Start with:
```bash
cd KARIGARI-main/KARIGARI
git status && git log --oneline -5
npm install
```

---

## 2. CONVENTIONS (match the existing code exactly)

- **Next.js 16 / React 19 / TypeScript / Tailwind v4 / Prisma 7 (Postgres, adapter-pg).** Path alias `@/` = `src/`.
- **Next 16 async APIs:** `await cookies()`, and `searchParams` is a Promise. Copy the auth block from any route under `src/app/api/artisan/*`.
- **Auth:** JWT in httpOnly cookie `auth-token`, secret `process.env.JWT_SECRET || 'fallback-secret'`, payload `{ userId, role }`. Artisan endpoints gate on `decoded.role !== 'ARTISAN'` (see `src/app/api/artisan/dashboard/route.ts`).
- **i18n:** the page uses `const { t, language } = useLanguage()` from `@/lib/translations` and renders `en / hi / or / te`. Keep every user-facing string translatable — follow the existing `language === 'or' ? ... : language === 'hi' ? ... : ...` pattern already in `schemes/page.tsx`, or add keys to `translations.ts`.
- **Design:** cream/green system — `bg-primary` (#1A4731), `font-serif` headings, `rounded-2xl`, `shadow-sm`, lucide icons, card layout. Match `artisan/dashboard/page.tsx` and the current `schemes/page.tsx` shell (header with back arrow + `KarigariLogo`).
- **Data fetch:** client page → `fetch('/api/...', { cache: 'no-store' })`.

---

## 3. WHAT EXISTS TODAY (and why it must be replaced)

Read `src/app/artisan/schemes/page.tsx`. Current reality:
- A **hard-coded array of 3 schemes**, each with a single `incomeLimit`. Eligibility = `income <= incomeLimit` **only**. That is the entire "engine."
- **"Auto-Apply via Agent" is fake** — `handleAutoApply` runs a `setTimeout` + `alert("your agent has submitted the application")` and never touches the DB. **Delete this.** Do not fake a government submission.
- "Apply Manually" button does nothing.
- Status is read from seeded `SchemeApplication` rows matched by fuzzy name.

**`SchemeApplication` model** (`prisma/schema.prisma`): `id, userId, schemeName, status (default "ELIGIBLE"), appliedAt?, notes?, createdAt`.

**Profile fields available for rules** (`ArtisanProfile`): `craftType, location, experienceYears, socialCategory?, annualIncome?, aadhaarLast4?, clusterName?, cooperativeId?, upiId?, giTagCertified, giTagName?`. Plus `User.craftItems` (count, `isListedOnMarketplace`, `patchId`, `status`).

⚠️ **Two data gaps you must handle (don't silently pass or fail):**
1. **`socialCategory` is not collected at registration** (only seeded for demo). NSFDC/NBCFDC depend on it. If missing → card status is **"Info needed: add your social category"**, not "ineligible." Add a `socialCategory` selector to `ProfileEditorModal.tsx` (and ideally the register form) so artisans can fill it.
2. **No date-of-birth / age**, and no data for PM Vishwakarma's exclusions (govt employee, prior Mudra/PMEGP/SVANidhi, one-per-family). These are **unverifiable from stored data** → handle as **self-declaration checkboxes at apply time** (§6), never as auto-passed rules.

---

## 4. THE REAL ELIGIBILITY CRITERIA (verified — encode these exactly)

Build a typed catalog + rules in **`src/lib/schemes.ts`**. Each scheme lists **published criteria mapped to profile fields**, an **official portal**, and an **apply mode**. Sources are current as of 2026; keep the official URLs live so "Direct Apply" opens the real portal.

### 1. PM Vishwakarma Yojana — `pm_vishwakarma`
- **Portal (Direct Apply):** https://pmvishwakarma.gov.in/ (registration via CSC).
- **Benefit:** ₹15,000 toolkit e-voucher; collateral-free loan up to ₹3L (₹1L + ₹2L) @5%; ₹500/day training stipend.
- **Rules:**
  - **Trade match (verifiable):** artisan's `craftType` must map to one of the **18 notified trades**: Carpenter, Boat Maker, Armourer, Blacksmith, Hammer/Tool-Kit Maker, Locksmith, Goldsmith, Potter, Sculptor/Stone Carver, Fishing-Net Maker, Cobbler/Shoesmith, Mason, Basket/Mat/Broom/Coir Maker, Doll & Toy Maker, Barber, Garland Maker, Washerman, Tailor.
  - ⚠️ **CRITICAL:** **Handloom / textile weaving is NOT in the 18 trades.** Most KARIGARI artisans (Ikat, Pochampally, Sambalpuri, saree, dupatta weavers) are therefore **INELIGIBLE for PM Vishwakarma** — the card must say so and point them to AHVY / NSFDC / NBCFDC. Getting this right is a differentiator; do not fudge weavers into eligibility.
  - **Age ≥ 18 (self-declare — no DOB stored).**
  - **Exclusions (self-declare):** not a government employee; has not availed PMEGP / PM SVANidhi / Mudra in the last 5 years; only one family member benefitting.
  - No income limit.
  - Provide a `craftType → trade` mapping helper (normalize lowercase; e.g. pottery/terracotta→Potter, leather/cobbler→Cobbler, tailoring/stitching→Tailor, bamboo/cane/basket→Basket Maker, wood/carpentry→Carpenter, jewellery/gold→Goldsmith, stone/sculpture→Sculptor, toys→Doll & Toy Maker; weaving/handloom/saree/textile/ikat/silk/cotton fabric→**no match**).

### 2. NSFDC (National Scheduled Castes Finance & Development Corp.) — `nsfdc`
- **Portal:** https://nsfdc.nic.in/ (applied via State Channelizing Agencies / banks) → **apply mode: DOWNLOAD_FORM / portal link**.
- **Benefit:** subsidised credit, skill training, marketing support for income-generating activity.
- **Rules (verifiable):** `socialCategory === 'SC'` **AND** `annualIncome ≤ 300000`.

### 3. NBCFDC (National Backward Classes Finance & Development Corp.) — `nbcfdc`
- **Portal:** https://nbcfdc.gov.in/ (online registration + channel partners) → **DIRECT link + form**.
- **Benefit:** concessional loans (term loan / micro-finance) for OBC/EWS.
- **Rules (verifiable):** `socialCategory ∈ {'OBC','EWS'}` **AND** `annualIncome ≤ 300000`.

### 4. GeM Seller Status (Government e-Marketplace) — `gem_seller`
- **Portal (Direct Apply):** https://gem.gov.in/ (free seller registration; artisan registers as proprietor).
- **Benefit:** sell directly to government buyers; no middleman.
- **Rules (verifiable "digital readiness"):** has `aadhaarLast4` (identity) **AND** has `upiId` (bank/financial). Ineligible reason if missing → "Add Aadhaar + UPI/bank to your profile." (Note in card: GST may be needed for taxable categories; PAN required at registration — self-declare "I have a PAN.")

### 5. AHVY — Ambedkar Hastshilp Vikas Yojana — `ahvy`
- **Implementing body / portal:** Office of the Development Commissioner (Handicrafts), under NHDP — https://handicrafts.nic.in/ → **DOWNLOAD_FORM / apply via cluster/cooperative**.
- **Benefit:** cluster development — toolkits (~₹5,000), margin money (~₹4,000/artisan), CFCs, marketing/exposure. Cluster-based (producer group/SHG with ≥50% cluster artisans as members).
- **Rules (verifiable):** `craftType` is a **handicraft/handloom** craft (true for most KARIGARI artisans) **AND** artisan belongs to a cluster/cooperative (`clusterName` present **OR** `cooperativeId` present). Ineligible reason if no cluster → "Join a registered cooperative/cluster to qualify."

### 6. ONDC Listing (Open Network for Digital Commerce) — `ondc`
- **Portal:** https://ondc.org/ (onboard via an ONDC Seller App / network participant) → **DIRECT link**.
- **Benefit:** list on the open national e-commerce network; reach nationwide buyers.
- **Rules (verifiable "market readiness"):** has `upiId` (settlement account) **AND** at least one **verified/listed** craft item (`isListedOnMarketplace === true` OR any craftItem with a `patchId`). Ineligible reason → "Verify & list at least one product first." (Card note: GST needed unless CGST §9(5) exempt — self-declare.)

---

## 5. ARCHITECTURE — the rules engine (`src/lib/schemes.ts`)

Make it a **pure, testable, transparent** module (this is the "not a black-box" requirement).

```ts
export type SchemeKey = 'pm_vishwakarma'|'nsfdc'|'nbcfdc'|'gem_seller'|'ahvy'|'ondc';

export interface Rule {
  id: string;
  label: string;                 // human-readable, e.g. "Social category is SC"
  verifiable: boolean;           // false → becomes a self-declaration checkbox at apply time
  evaluate?: (ctx: EligibilityContext) => { pass: boolean; actual?: string; needed?: string };
}

export interface Scheme {
  key: SchemeKey;
  name: string; description: string; benefit: string;   // i18n-friendly
  officialUrl: string;
  applyMode: 'DIRECT' | 'DOWNLOAD_FORM';
  formPath?: string;             // for DOWNLOAD_FORM (a real static form in /public, or the portal)
  rules: Rule[];
}

export interface EligibilityContext {
  socialCategory?: string; annualIncome?: number; craftType?: string;
  aadhaarLast4?: string; upiId?: string; clusterName?: string; cooperativeId?: string;
  hasListedItem: boolean; hasVerifiedItem: boolean;
}

export type SchemeVerdict =
  | { status: 'ELIGIBLE'; failed: []; selfDeclare: Rule[] }
  | { status: 'INELIGIBLE'; failed: Rule[]; selfDeclare: Rule[] }
  | { status: 'INFO_NEEDED'; missing: string[] };   // e.g. socialCategory not set

export function evaluateScheme(scheme: Scheme, ctx: EligibilityContext): SchemeVerdict;
export function evaluateAllSchemes(ctx: EligibilityContext): Array<Scheme & { verdict: SchemeVerdict }>;
export const SCHEMES: Scheme[];
```

Rules of the engine:
- **INFO_NEEDED** when a verifiable rule needs a field the artisan hasn't filled (e.g. `socialCategory` for NSFDC/NBCFDC). Surface *which* field, with a link to `ProfileEditorModal`.
- **INELIGIBLE** when a verifiable rule fails on known data (e.g. weaver → PM Vishwakarma). Always attach the human reason (`actual` vs `needed`).
- **ELIGIBLE** when all verifiable rules pass; any non-verifiable rules become `selfDeclare` checkboxes shown in the apply modal.
- Keep it deterministic and unit-testable — export the pure functions so a quick test file can assert e.g. "SC + ₹1.8L ⇒ NSFDC ELIGIBLE", "weaver ⇒ PM Vishwakarma INELIGIBLE".

---

## 6. API (server-evaluated — never trust the client)

**`GET /api/artisan/schemes`** (gate `ARTISAN`):
- Load the artisan's `User` + `ArtisanProfile` + a small craft-item summary (`hasListedItem`, `hasVerifiedItem`) via `prisma`.
- Build `EligibilityContext`, run `evaluateAllSchemes`, join with existing `SchemeApplication` rows to attach current status.
- Return `{ success, profileSummary, schemes: [{...scheme, verdict, application? }] }`.

**`POST /api/artisan/schemes/apply`** (gate `ARTISAN`):
- Body `{ schemeKey, selfDeclarations: Record<string,boolean> }`.
- **Re-evaluate eligibility server-side**; reject if not ELIGIBLE or if any required self-declaration is unchecked.
- Upsert `SchemeApplication` (match on `userId` + scheme) → `status: 'APPLIED'`, `appliedAt: new Date()`, `notes`. Return the updated row.
- Do **not** claim to transmit anything to the government. This records the artisan's intent and moves the tracker; the actual submission happens on the official portal the Direct-Apply button opens.

**Schema tweak (recommended):** add a stable `schemeKey String?` to `SchemeApplication` and match on it (the current fuzzy name-matching in the page is fragile). Run `npx prisma db push && npx prisma generate` (⚠️ then **restart the dev server** — a stale Prisma client throws `Unknown argument`). Keep `schemeName` too for display/back-compat. Standardize `status` values to: `ELIGIBLE`, `APPLIED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `DISBURSED` (the definition's core path is ELIGIBLE → APPLIED → APPROVED).

---

## 7. UI — rebuild `src/app/artisan/schemes/page.tsx`

Keep the existing header shell (back arrow + title + `KarigariLogo`) and i18n. Replace the body:

- **Fetch** from `/api/artisan/schemes` (remove the hard-coded `allSchemes` array and the fake `handleAutoApply`).
- **Profile banner (dynamic):** show verified Aadhaar (`•••• {aadhaarLast4}`), declared income, and **social category** — if `socialCategory` is missing, show a soft prompt "Complete your profile to unlock SC/OBC schemes" linking to `ProfileEditorModal`.
- **Two sections:**
  - **"Eligible for you (N)"** — green-accented cards. Each shows name, description, **benefit chip**, and the action(s): **Direct Apply** (opens `officialUrl` in a new tab, `rel="noopener"`) or **Download Form** (for `DOWNLOAD_FORM` schemes), plus **"Track application"** which calls the apply API and advances the status.
  - **"Not yet eligible (N)"** — greyed cards, each showing the **specific reason** from the verdict ("Requires SC category — yours: OBC", "Weaving isn't among PM Vishwakarma's 18 trades — see AHVY", "Add a UPI ID to qualify", "Join a cooperative cluster"). For **INFO_NEEDED**, show a "Complete profile" button instead of a hard "ineligible."
- **Apply modal:** when the artisan clicks Apply on an ELIGIBLE scheme that has `selfDeclare` rules, show those as **required checkboxes** (e.g. "I am not a government employee", "I haven't availed Mudra/PMEGP/SVANidhi in 5 years", "I have a PAN card"). Only when all are ticked → enable the confirm button → call the apply API → optimistic status → **ELIGIBLE → APPLIED** with the existing badge styling (Clock/CheckCircle2/Award colors already in the file).
- **Status badges:** reuse the current color logic — APPLIED/UNDER_REVIEW = orange, APPROVED = green, DISBURSED = blue.
- Smooth rendering: loading skeletons, empty states, no layout shift; mobile-friendly (match the current responsive classes).

---

## 8. SEED (`prisma/seed.ts`) — make the demo prove the engine

Update the seed so the live demo visibly shows the engine discriminating on real data:
- Ensure the demo artisan (Lakshmi — Pochampally **Ikat weaver**, OBC, income ₹1.8L, has `clusterName`, `upiId`, `aadhaarLast4`, a verified/patched item) demonstrates: **NSFDC = INFO/ineligible (not SC)**, **NBCFDC = ELIGIBLE (OBC + ₹1.8L)**, **AHVY = ELIGIBLE (handloom + cluster)**, **GeM = ELIGIBLE (Aadhaar+UPI)**, **ONDC = ELIGIBLE (UPI + listed item)**, **PM Vishwakarma = INELIGIBLE (weaver, not one of 18 trades)** — a perfect teaching example.
- Add a second demo artisan whose craft **is** a PM Vishwakarma trade (e.g. a **Potter**, SC, low income) so PM Vishwakarma and NSFDC both light up ELIGIBLE.
- Seed a couple of `SchemeApplication` rows in `APPLIED` / `APPROVED` / `DISBURSED` so the tracker shows all states.
- Re-run the seed (check `package.json` / `prisma.config.ts` for the command; likely `npx prisma db seed` or `npx tsx prisma/seed.ts`).

---

## 9. GUARDRAILS (violating any fails the task)

- **Real criteria only.** Encode the §4 rules and official URLs exactly. Do not invent income limits or benefits. If a rule can't be checked from stored data, it's a **self-declaration**, not an auto-pass.
- **Honest apply.** Never state or imply the app submitted an application to a government system (the old "your agent submitted" alert is banned). Direct Apply opens the real portal; the tracker records intent/status internally.
- **Server-side evaluation.** Eligibility and apply checks run in the API against the DB — the client only renders. No eligibility logic that a user can bypass by editing the page.
- **Weavers ≠ PM Vishwakarma.** The trade mapping must correctly exclude handloom/textile weaving.
- **INFO_NEEDED over false negatives.** Missing `socialCategory`/`upiId` shows a "complete profile" path, not a dead "ineligible."
- **Keep i18n, design system, and Next 16 async APIs.** Reuse `useLanguage`, the card/badge styles already in the file, and `@/lib/prisma`.
- **Restart dev server after any `prisma generate`.**

---

## 10. VERIFICATION (do all before done)

```bash
npx tsc --noEmit && npm run build      # compiles clean (files you touch lint clean)
```
Then `npm run dev` and, logged in as each seeded artisan:
1. **Weaver (Lakshmi):** PM Vishwakarma appears under **Not yet eligible** with the "not among 18 trades" reason; NBCFDC/AHVY/GeM/ONDC appear **Eligible**; NSFDC shows the SC-required reason.
2. **Potter (SC):** PM Vishwakarma **Eligible**; clicking Apply opens the self-declaration modal; confirming moves the card to **APPLIED** and persists (reload → still APPLIED; row exists in DB).
3. **Direct Apply** opens the correct official government portal in a new tab.
4. An artisan with no `socialCategory` sees **Info needed → Complete profile**, and after setting SC/OBC via `ProfileEditorModal`, the relevant scheme re-evaluates on refetch.
5. No fake alerts remain; no hard-coded scheme array remains; eligibility reflects real DB values.

Report new/edited files, the rules encoded per scheme, and anything stubbed (e.g. downloadable form PDFs if not provided — use the official portal link as the fallback action).

---

## 11. DEFINITION OF DONE

`/artisan/schemes` is a working **rules engine** over the six real schemes: eligibility is computed server-side from the artisan's actual profile against the **published criteria in §4**, cards split into **Eligible / Not-yet-eligible / Info-needed** with **specific reasons**, each eligible scheme offers **Direct Apply (real portal) or Download Form**, and application state **persists and tracks ELIGIBLE → APPLIED → APPROVED**. Weavers are correctly excluded from PM Vishwakarma; nothing fakes a government submission; the seed demonstrates every branch.
