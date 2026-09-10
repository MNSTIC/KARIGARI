# KARIGARI — GOOGLE COMPLETION SCREEN: REBUILD, ARTISAN-ONLY, SECURITY FIX

> Single focused prompt. One page and three server files. Work through the sections in order and finish with the verification pass — do not stop at the visual half.

You are a principal engineer working in the KARIGARI codebase (Next.js 16.3.1 App Router, React 19, TypeScript, Tailwind v4, Prisma 7). The Google sign-in flow works, but the screen that finishes an artisan sign-up — `src/app/register/complete/page.tsx` — was built as a standalone card that does not belong to this app's design system, it offers a role choice it must not offer, and that role choice is a **privilege-escalation hole**. Fix all three.

## Read first

- `src/app/register/complete/page.tsx` — the page being rebuilt
- `src/app/register/page.tsx` — **the layout and styling reference. Match this file.**
- `src/app/login/page.tsx` — the same shell, and the `?notice=` message rendering
- `src/app/api/auth/google/callback/route.ts` — the three-way fork; sets the `pending-signup` cookie and redirects with `?role=`
- `src/app/api/auth/google/pending/route.ts` — what the screen reads to render the header
- `src/app/api/auth/google/complete/route.ts` — creates the account via `validateSignup()`
- `src/lib/registrationRules.ts` — `validateSignup()`, `isSignupRole()`, `ROLES`
- `src/lib/authCookies.ts` — `COOKIE`, `setSignedCookie`, `peekCookie`, `takeCookie`, `PendingSignup`
- `src/components/ui/Avatar.tsx`, `src/lib/gender.ts`, `src/app/globals.css` (design tokens), `src/lib/i18n/en.ts | hi.ts | or.ts | te.ts`

---

## PART 1 — CRITICAL SECURITY FIX (do this first, it constrains the UI)

**The hole.** `/register/complete` receives the requested role as a **URL query parameter** (`complete.searchParams.set('role', stashed.role)` in the callback), the page keeps it in React state, and it posts that role in the request body. `/api/auth/google/complete` then trusts it: `validateSignup({ ...body, name: ... })` reads `body.role`. So anyone finishing a Google sign-up can open `/register/complete?role=ADMIN` — or simply POST `{"role":"ADMIN"}` — and create themselves an **ADMIN account** with full access to `/admin/facilitator`, `/admin/nodal`, the unmasked artisan CRM, patch minting and the compliance export. A query parameter is attacker-controlled input; it must never decide a role.

Fix it properly:

1. **Carry the role in the signed `pending-signup` cookie, not the URL.** In `src/app/api/auth/google/callback/route.ts`, add `role: stashed.role` to the `setSignedCookie(COOKIE.pendingSignup, {...})` payload, and extend the `PendingSignup` interface in `src/lib/authCookies.ts` with `role: SignupRole`. Stop appending `?role=` to the redirect — redirect to a bare `/register/complete`.
2. **Make `/api/auth/google/complete` ignore `body.role` entirely.** Call `validateSignup({ ...body, name: body?.name || pending.name, role: pending.role })` — with `role` written *after* the spread so a body value cannot override it. Add a comment saying exactly why the order matters, because it looks like a stylistic choice and is not.
3. **An ADMIN never reaches this screen.** In the callback's third fork, when `stashed.role === 'ADMIN'`, create the user immediately — `validateSignup` already returns `artisanProfile: null` for an admin, so there is nothing left to collect — issue the session, and redirect to the admin dashboard. Only `ARTISAN` gets the `pending-signup` cookie and the completion redirect. Reuse the creation logic rather than writing a second `user.create`: extract it into a small helper (e.g. `createGoogleUser()` in `src/lib/googleAuth.ts` or a new `src/lib/googleSignup.ts`) that both the callback and the complete route call, keeping the in-transaction email/`googleId` clash re-check and the `P2002` → 409 handling intact.
4. **Fix the broken admin redirect.** Both `src/app/api/auth/google/callback/route.ts` and `src/app/register/complete/page.tsx` send admins to **`/admin/dashboard`**, which does not exist — there is no `src/app/admin/dashboard` directory, only `admin/facilitator` and `admin/nodal`, and `src/app/login/page.tsx` correctly uses `/admin/facilitator`. Every admin landing in this flow currently 404s. Change both to `/admin/facilitator`, and grep for any other `'/admin/dashboard'` string and fix those too.
5. `/api/auth/google/pending` must **not** return the role to the browser. The page no longer needs it — the page is artisan-only by construction. Keep `sub` withheld as it already is.

---

## PART 2 — REBUILD THE PAGE

Delete the role toggle and the `role` state. This screen is **artisan-only**: no "I'm joining as ADMIN", no conditional `{role === "ARTISAN" && ...}` wrapper, no `ADMIN` branch in the redirect. Every field renders unconditionally because every visitor is an artisan.

### 2a. Use the app's auth shell, not a floating card

The page currently renders a lone `rounded-3xl` white card centred on the beige `--color-background`. `/login` and `/register` share a different, established shell, and this screen is the third step of that same flow — it must look like it belongs. Adopt the `/register` structure exactly:

- Root: `min-h-screen bg-[var(--color-background)] font-sans lg:grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]`
- **Left plate** (`hidden lg:block`): the `/hero-mural.jpg` fill image with the `bg-gradient-to-t from-black/80 via-black/35 to-black/20` scrim, and bottom-anchored copy in the same rhythm as `/register` — a `kg-display text-[30px] text-white` heading, a `max-w-xs text-[15px] text-white/75` paragraph, and the `kg-label` rule-and-caption line. Write copy for *this* step: the person has already proved who they are and is one form from a working workshop. Do not reuse `/register`'s words verbatim.
- **Right panel**: `flex min-h-screen flex-col justify-center bg-white px-6 py-12 sm:px-10 lg:px-16`, inner column `mx-auto w-full max-w-[520px]`, starting with the `Karigari` wordmark `<Link href="/">` in `kg-display text-2xl`, then the `kg-display mt-10 text-[28px]` page heading.

### 2b. Header block — who Google says this is

Replace the hand-rolled initials circle with the app's `<Avatar name={...} src={...} size={56} />`, which already derives a colour from the name. Present the verified identity as a settled fact in a `rounded-2xl bg-[var(--color-background)] p-4` panel — the same treatment `/register` gives its photo row — with the name, the email as read-only secondary text, and a small `ShieldCheck`-marked line saying the email is verified by Google and cannot be edited here. Do not render the email in an input.

**Check `next.config.ts`** for an `images.remotePatterns` entry covering `lh3.googleusercontent.com` before relying on `next/image` for the Google avatar. If it is absent, either add it or pass the URL through `<Avatar>`'s plain `<img>` path — a broken avatar on the first screen of a new account is worse than no avatar. Handle the load-error case so a dead Google URL falls back to initials.

### 2c. Group the eight fields into three labelled sections

A flat stack of eight inputs is what makes this screen feel unfinished. Use the same section rhythm the rest of the app uses (see `src/components/ui/SectionLabel.tsx` and how `/artisan/orders` and the demand modal head their groups):

1. **Your details** — full name (prefilled from Google, editable), gender.
2. **Your craft** — craft type, location, years of experience.
3. **Verification & group** — Aadhaar last 4, annual income, then cluster name and SHG link as clearly-marked optional fields.

Each section gets a heading and, where a field is not self-evident, one line of helper text tied to the input with `aria-describedby`. Keep the existing `gender_why` explanation — an artisan being asked their gender deserves the reason, and it is the Womaniya eligibility check.

### 2d. Field styling — reuse, don't reinvent

Drop the local `INPUT` / `LABEL` constants in favour of the classes `/register` already uses, so the two screens are indistinguishable. If you want them shared, extract the field primitives into `src/components/ui/FormField.tsx` and refactor **both** pages onto it — but do not leave two divergent sets of input styles in the codebase.

Specifics to fix:
- `craftType` is hardcoded to `"Ikat"` as its initial state. Nobody chose that. Start it empty with a `placeholder` and a `datalist` of the craft types the app already knows (`src/lib/giLabels.ts` / the seed data are the source), so it suggests without pre-deciding.
- The gender `<select>` has `appearance-none` and no chevron, so it looks like a dead text input. Add a `ChevronDown` positioned over it, or drop `appearance-none`.
- `aadhaarLast4` uses `type="text"` with `pattern="[0-9]{4}"`. Add `inputMode="numeric"` and `autoComplete="off"`, and reject non-digits on change — on a phone this must bring up the number pad. Label it plainly as the **last four digits only**, and say the full number is never asked for.
- `annualIncome` and `experienceYears` need `inputMode="numeric"` and sensible `min`/`max`.
- Add `autoComplete` to name (`name`) and location (`address-level2`).

### 2e. Validation that helps

Right now the only feedback is a single server error string at the top after a failed POST. Add client-side, field-level validation that mirrors `validateSignup()` exactly — required: name, gender, Aadhaar last 4 (exactly 4 digits), annual income (a finite number ≥ 0). Show the message under the offending field, mark it `aria-invalid`, move focus to the first invalid field on submit, and keep the top-level error box for genuine server errors. Never let the submit button be pressable into a silent no-op.

### 2f. Success state

The `created` branch currently swaps the form for a bare paragraph and two buttons. Make it a real success state inside the same shell: a `CheckCircle2` confirmation that the account exists, then the passkey offer as a clearly optional upgrade with one line on what a passkey buys them (no password to remember, works with their phone or laptop unlock), the `Fingerprint` CTA, and the continue-to-dashboard action. Keep both actions equally weighted — skipping is a legitimate choice, not a greyed-out afterthought. Preserve the existing swallow of `NotAllowedError` / `AbortError`, which is correct: a person cancelling the platform's passkey sheet has not hit an error.

The dashboard redirect is now unconditionally `/artisan/dashboard`.

### 2g. States and polish

- The `checking` state is a bare centred spinner on an empty page. Give it the real shell with a skeleton in the panel, matching `src/components/ui/RouteSkeleton.tsx`.
- `if (!pending) return null` renders a blank white page in the window before the redirect lands. Render the shell with a short "taking you back to sign-in" line instead.
- Disable the submit button and every input while `loading`, so a double-submit cannot burn the single-use cookie twice.
- The cookie expires in ten minutes. If the POST returns 401 because it expired, say so specifically ("Your Google sign-in expired — please start again") with a link back to `/login`, not the generic failure string.
- Mobile: single column, tap targets ≥44px, nothing overflowing at 360px, no horizontal scroll. The `grid-cols-2` field pairs must stack below `sm`.

### 2h. i18n

Every string on this page must be a key present in **all four** dictionaries (`en`, `hi`, `or`, `te`) with real translations, not English placeholders. Several `t()` calls the page already makes may have no key at all — audit each one (`auth_complete_title`, `auth_complete_cta`, `auth_creating`, `auth_complete_failed`, `passkey_offer_body`, `passkey_added`, `passkey_add_cta`, `passkey_skip`, `gender_select`, `gender_why`, `cluster_name_optional`, `cluster_name_hint`, `shg_link_optional`, `shg_link_hint`, `craft_type`, `experience_years`, `aadhaar_last4`, `annual_income`, `full_name`, `location`, `continue_btn`) and add whatever is missing. Delete the now-unused `auth_role_label`, `artisan` and `admin` keys **only** if nothing else references them — grep first.

---

## Rules

- Existing design tokens only: `--color-maroon`, `--color-primary`, `--color-pill`, `--color-background`, the warm gray ramp, `kg-display` / `kg-label` / `kg-press`, `shadow-card`. No new colours, radii, shadows or fonts.
- Match the surrounding code: `"use client"` where needed, `export const dynamic = 'force-dynamic'` on handlers reading cookies, `NextResponse.json` with real status codes, route-prefixed `console.error`.
- Comments explain **why**, in full sentences, in this repo's existing voice.
- No `any`, no unused imports, no `console.log` left in the component.
- Do not touch the password `/register` flow's behaviour. Do not touch `validateSignup()`'s rules — only where its `role` comes from.

---

## VERIFICATION PASS — run this, do not skip it

### Gates
```
npx tsc --noEmit
npm run lint
npm run build
```
Zero type errors, zero lint errors, clean build. Paste the real output.

### Security — prove each one in the code
1. POST `/api/auth/google/complete` with `{"role":"ADMIN", ...}` in the body while the pending cookie says `ARTISAN` → an **ARTISAN** is created. Trace the exact line that makes the body value lose.
2. Navigating directly to `/register/complete?role=ADMIN` → the query parameter is read nowhere and changes nothing.
3. A Google sign-up started from `/login?role=admin` → the account is created in the **callback**, lands on `/admin/facilitator`, and never sees the completion screen.
4. Grep the whole repo for `'/admin/dashboard'` → no hits remain.
5. Double-submitting the form → the single-use cookie is burned once; the second attempt gets the expiry message, not a second account.
6. An expired pending cookie → 401 with the specific message and a route back to `/login`.

### Visual and functional
7. Open `/login`, `/register` and `/register/complete` side by side at 1440px: same plate width, same panel padding, same wordmark position, same heading scale, same input styling, same CTA. Anything that differs is a defect — list it or fix it.
8. 360px width: single column, no horizontal scroll, every tap target ≥44px, the `grid-cols-2` pairs stacked.
9. Keyboard only: tab order follows visual order, every control has a visible focus ring and an accessible name, the form submits on Enter.
10. Submit empty → per-field messages, `aria-invalid` set, focus on the first invalid field, no network request.
11. Submit valid → account created, success state, passkey offer, continue lands on `/artisan/dashboard`.
12. Cancel the passkey sheet → no error shown, still able to continue.
13. Google avatar: renders when the URL works, falls back to initials when it 404s, and `next/image` does not throw an unconfigured-host error.
14. Diff the four i18n dictionaries' key sets with a throwaway script and paste the result — they must be identical.

### Report
What you changed and why, the security trace for items 1–4, the gate output, and anything left undone with the reason. Do not claim a check passed that you did not actually perform.
