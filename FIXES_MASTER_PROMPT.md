# MASTER PROMPT — KARIGARI Fixes: Artisan 403 + Demand-Map Location Pins

> Paste this whole file into Claude Code. Two focused fixes with exact file/line references. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there; `npm install`; after any `prisma generate`, restart `npm run dev`). Match the existing theme in `src/app/globals.css` (primary `#24332C`, background `#FCF8F7`, mint `#DCEBE0`) and keep `useLanguage` i18n.

---

## FIX 1 — "Forbidden. Artisan access required." console error

### Root cause (confirmed)
- `src/app/api/artisan/schemes/route.ts` **lines 41–43** returns **403** `{ error: 'Forbidden. Artisan access required.' }` whenever the JWT role is not `ARTISAN`. `src/app/api/artisan/insights/route.ts` **lines 51–53** does the same.
- `src/app/artisan/schemes/page.tsx` `load()` (**lines 149–184**) handles **401** (logout + `router.replace('/login')`, lines 159–163) but **not 403** — so a 403 falls through to **lines 166–167** `throw new Error(data.error || "Request failed")`, which is the console error in the report.
- **When does role ≠ ARTISAN happen?** When you are signed in as the **ADMIN** and open an `/artisan/*` page. Nothing guards `/artisan/*` by role: the landing page (`src/app/page.tsx`) "For Artisans" button and direct URLs let an admin session load artisan pages, which then 403. (The demo super-admin path was removed; login now issues `{ userId, role }` straight from the DB — see `src/app/api/auth/login/route.ts`.)

### What to change

**(a) Handle 403 like 401 in every artisan client fetch.** Anywhere an `/artisan/*` (or artisan-only) API is fetched and the code branches on `res.status === 401`, also branch on `403` → the current session isn't an artisan, so log out and `router.replace('/login')` instead of throwing. Apply in:
- `src/app/artisan/schemes/page.tsx` line ~159 (change `=== 401` to `=== 401 || === 403`).
- `src/app/artisan/insights/page.tsx` (its load/fetch handler — same treatment; the map fetch and the `/api/artisan/insights` fetch).
- `src/app/artisan/market/page.tsx`, `src/app/artisan/dashboard/page.tsx` (any fetch that can 401/403).
- `src/components/NotificationsBell.tsx` (it polls `/api/artisan/notifications`; on 401/403 it must go quiet — no console spam, no throw).

**(b) Add a real role guard so `/artisan/*` and `/admin/*` are only entered by the right role.** Two clean options — pick ONE and apply consistently:
- Preferred: a lightweight **`GET /api/auth/me`** route returning `{ userId, role }` from the cookie (reuse the standard verify block). Then in **`src/app/artisan/layout.tsx`** (already a client component) call it on mount and `router.replace('/login')` (or `/admin/facilitator` if role is ADMIN) when role ≠ `ARTISAN`, rendering nothing until confirmed. Mirror the same guard for the admin area in **`src/components/AdminShell.tsx`** (redirect non-ADMIN to `/login`).
- Alternative: Next.js `middleware.ts` at project root that reads the `auth-token` cookie, verifies it, and redirects `/artisan/*` for non-artisans and `/admin/*` for non-admins. (Only if you keep JWT verify edge-compatible.)

**(c) Fix the entry points that send the wrong role into artisan pages.** In `src/app/page.tsx`, the "For Artisans" / "For Admins" buttons link straight to `/artisan/dashboard` / the admin dashboard regardless of who is logged in. Make them role-aware (or route through `/login`), so an admin never lands on an artisan page and vice-versa.

**(d) Make sure a seeded ARTISAN account exists** and note its credentials in the run output, so the artisan pages are tested while logged in as an artisan (the schemes/insights pages are artisan-only by design). Do **not** loosen the API role checks — the 403 itself is correct; the bug is the unguarded navigation + the page throwing on 403.

### Fix 1 acceptance
- Logged in as the **artisan**: `/artisan/schemes` and `/artisan/insights` load with no console error.
- Logged in as the **admin**: opening `/artisan/*` cleanly redirects (to `/login` or the admin dashboard) — no "Forbidden" thrown to the console, no blank page. Same protection the other way for `/admin/*`.
- `NotificationsBell` never logs errors when the session can't read artisan notifications.

---

## FIX 2 — Demand-forecast map: pin the artisan's REAL location, compute data around it

### Current state (confirmed)
`src/app/artisan/insights/page.tsx` already builds pins dynamically: `pins` useMemo (**~lines 158–181**) calls `locateCity(demand.location)` + `toMapPercent(point)` from `src/lib/indiaGeo.ts`, and lists demands it can't resolve as `unmapped` (~line 181). So pins are NOT hardcoded — but they are placed at **buyer demand cities only**, with **no pin for the artisan's own location**, which is why the map feels random and disconnected from where the artisan actually is.

### What the user wants
Show the artisan's **actual location from their profile** (the `location` they entered at registration / profile edit — `ArtisanProfile.location`) as a pin on the map, and compute the demand/supply figures relative to that location.

### What to change

**(a) Return the artisan's location from the insights API.** In `src/app/api/artisan/insights/route.ts`, the profile query already selects `location` (line ~59). Add the raw `location` (and keep `cluster`) to the JSON response (near lines 239–241, alongside `craftType`/`cluster`) as e.g. `profileLocation`.

**(b) Add a distinct "Your location" home pin.** In `insights/page.tsx`, resolve the artisan's location with `locateCity(insights.profileLocation)` → `toMapPercent(...)` and render a visually distinct marker (a home / "you are here" pin in `--color-primary`, not the demand-pin style). Center the OSM iframe on the artisan's region when their location resolves, so their pin sits near the middle (adjust the iframe `bbox`/marker so `MAP_BBOX` in `indiaGeo.ts` still matches whatever bbox the iframe uses — the projection math in `toMapPercent` depends on that agreement).

**(c) Compute demand data relative to the artisan's location.** For each demand pin, keep the real quantity/price from the DB (`Demand` rows), and additionally:
- Sort/label demands by **proximity** to the artisan's resolved point (nearest first). Add a small haversine helper in `indiaGeo.ts` (`distanceKm(a, b)`); label pins "near you" vs the distance in km.
- Show the artisan's **own supply** near their pin (their listed/verified `CraftItem` count for that craft) so the map contrasts local supply vs incoming demand — no invented numbers; use real counts.

**(d) Make the artisan's location actually resolvable.** `locateCity` matches against the `CITY_COORDS` gazetteer in `indiaGeo.ts` (substring, longest-key-first). If a real artisan's typed `location` doesn't match, the home pin can't render.
- Extend `CITY_COORDS` to cover the seeded artisans' and common craft-cluster locations (e.g. ensure Pochampally, Bargarh, Sambalpur, Bhubaneswar, etc. resolve — several already do; add any that the seed/profiles use).
- Graceful fallback: if the artisan's `location` still doesn't resolve, show a labeled banner ("Set a recognised town in your profile to see your position on the map") and a "Edit profile" action — never drop a pin at an invented spot.
- Optional but recommended: make the profile `location` field (in `src/components/ProfileEditorModal.tsx` and the register form) a **searchable select of known cities** (keys of `CITY_COORDS`) so a saved location always resolves on the map.

**(e) Seed for a convincing demo.** In `prisma/seed.ts`, seed a few `Demand` rows whose `location` and `craftType` are near/relevant to the demo artisan (e.g. demands in Hyderabad/Delhi/Mumbai for Pochampally Ikat), and confirm the demo artisan's profile `location` resolves — so on first load the map shows the artisan's home pin plus real nearby demand pins.

### Fix 2 acceptance
- The insights "Live Demand Map" shows a distinct **"Your location"** pin at the artisan's real profile location (from `ArtisanProfile.location`), with the map centered so it's visible.
- Demand pins are real `Demand` rows placed by `locateCity`, labeled by distance/relevance to the artisan; quantities/prices come from the DB; the artisan's own supply count is shown.
- No pin is placed at an invented/guessed location; unresolved locations are listed in a labeled fallback, not scattered randomly.
- Changing the artisan's profile location moves the home pin and re-sorts nearby demand.

---

## GLOBAL GUARDRAILS
- Don't weaken any API auth check — 403/401 gating is correct; fix navigation + client handling instead.
- No hardcoded map pins or invented numbers; everything from the DB / profile.
- Keep the theme tokens and `useLanguage` i18n; every new string translatable.
- Verify before done:
```bash
npx tsc --noEmit && npm run build
```
Then `npm run dev`: (1) admin→/artisan/* redirects, artisan→/artisan/schemes & /insights load clean, no console errors; (2) map shows the artisan's home pin + real nearby demand. Report changed/new files and the seed update.
