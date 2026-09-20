# KARIGARI — MASTER PROMPT: ARTISAN DASHBOARD COLOUR HARMONISATION (COLOUR VALUES ONLY)

> Paste this whole file into Claude Code. It is a **single-pass, surgical colour task**.
> Three dashboard-only components were built with raw, saturated hex values that belong to no
> palette. They look out of place against the rest of KARIGARI. Your job is to re-point those
> values at the theme's own tokens — **and change nothing else.**

---

## 0. MISSION, IN ONE SENTENCE

Re-colour three components on `/artisan/dashboard` so they read as part of the same product as
every other page — **without touching a single line of layout, structure, markup, copy, spacing,
sizing, animation, data, or logic.**

The features are liked. The design is liked. Only the **colour values** are wrong.

---

## 1. GROUND RULES — READ TWICE

### 1.1 You may change

- Hex colour **values** in the three specific locations listed in §3.
- Nothing else. Not one other character.

### 1.2 You may NOT change — this is exhaustive and absolute

- ❌ Any JSX structure, element, nesting, or ordering
- ❌ Any `className` **other than** the colour utility inside it (e.g. you may change
  `bg-[#245C42]` → `bg-[var(--color-green-600)]`, but you may **not** touch `rounded-full`,
  `h-4`, `mt-3`, `transition-all`, `duration-500`, `overflow-hidden` sitting beside it)
- ❌ Any spacing, padding, margin, gap, radius, border-width, font-size, font-weight, tracking
- ❌ Any animation, transition, keyframe, duration, easing, delay, or the ticker's motion variables
- ❌ The texture overlay inside the health bar — `/droodle-bg.jpg`, `bg-repeat`,
  `bg-[length:150px_auto]`, `mix-blend-color-burn` all **stay exactly as they are**
  (opacity is the single, last-resort exception — see §6.2)
- ❌ The three SVG icon components in `MonthlyOverview.tsx` (`CraftToolsIcon`, `VerifyDocIcon`,
  `PeopleIcon`) — their **paths, opacities, `stroke-width`s and internal white highlights** are
  untouched. Only the single `color` value passed **in** changes.
- ❌ Any copy, any i18n key, any translation file. **This task adds zero strings**, so no
  dictionary work at all.
- ❌ Any data, prop, interface, API call, or piece of logic
- ❌ Any other page, component, or file beyond the three named in §3
- ❌ `src/app/globals.css` — **do not add, rename, or redefine a single token.** Every colour you
  need already exists there. If you think you need a new token, you have misread the palette.
- ❌ No new dependency. No reformatting. No "while I was in here" improvements.

### 1.3 The blast radius is already proven to be zero

Verified before this prompt was written:

| Component | Used by |
|:--|:--|
| `NotificationTicker` | `src/app/artisan/dashboard/page.tsx:331` — **and nowhere else** |
| `MonthlyOverview` | `src/app/artisan/dashboard/page.tsx:337` — **and nowhere else** (its own header comment says "Dashboard-only on purpose") |
| `TrustAndReportsCard` | defined and used inside `src/app/artisan/dashboard/page.tsx` only |

So a value change in these three files cannot leak anywhere. **Do not "helpfully" extend the change
to other pages.** If you find similar hex elsewhere, leave it and mention it in your report.

---

## 2. THE THEME — YOUR ONLY PALETTE

Defined in the `@theme` block of `src/app/globals.css`. **Read that file first.** Its own header
comment states the character of the design:

> *"a warm off-white canvas, near-black ink instead of forest green, and maroon / terracotta as the
> only two accents"* … *"Red is the maroon family, orange the terracotta family. Green is a muted
> olive rather than the old sage… **nothing in this design is allowed to be bright.**"*

That last clause is the whole brief.

```
Surfaces   --color-background #F6F3EE   --color-card #FFFFFF   --color-sidebar #F1EDE6
           --color-pill #ECE7E0         --color-cream #F6F3EE
Ink        --color-primary #1A1A1A      --color-primary-dark #2E2926  --color-primary-light #4A423C
Accents    --color-maroon #5A1A1A       --color-maroon-soft #7E2A22
           --color-rust #C2632F         --color-rust-deep #B45309     --color-pink #F8D9CE
Neutrals   --color-sage #D9D0C4         --color-mint #ECE7E0   (both warm neutrals now, NOT green)
Stat       --color-stat-teal #4A5241    --color-stat-orange #C2632F
           --color-stat-blue #4D5D6C    --color-stat-brown #9A7B3F
Gray ramp  50 #FAF8F5 · 100 #F1EDE6 · 200 #E4DED5 · 300 #D2CBC1 · 400 #A39C93
           500 #6E675F · 600 #55504A · 700 #3D3934 · 800 #2A2724 · 900 #1A1A1A
Green      50 #EFF0E8 · 100 #E2E5D6 · 200 #D0D4C0 · 300 #B4BAA0 · 400 #7C8468
           500 #566049 · 600 #49523E · 700 #3C4433 · 800 #30372A · 900 #232819
Blue       50 #E9EDF0 · 100 #D6DDE4 · 200 #C0CAD4 · 500 #4D5D6C · 600 #42505D · 700 #37424D · 800 #2C353E
Orange     50 #FBEDE3 · 100 #F4DCC9 · 500 #C2632F · 600 #AE5527 · 700 #94481F · 900 #5E2C12
Red        50 #FBE9E5 · 100 #F6D6CE · 200 #EDBCB0 · 500 #8C2B22 · 600 #7A241C · 700 #5A1A1A
Yellow     50 #F6EEDD · 100 #EDE0C6 · 500 #9A7B3F · 600 #8A6E38 · 700 #7C6231 · 800 #63501F
```

**Prefer the token form `var(--color-x)` wherever the file allows it.** §5 explains the two places
where it does not, and what to do there instead.

---

## 3. THE THREE OFFENDERS — EXACT LOCATIONS

### Offender A — the three metric cards ("5 ITEMS SOLD / 1 PENDING VERIFICATION / 1 GOVT SCHEMES ACTIVE")

`src/components/dashboard/MonthlyOverview.tsx`

- the `TONES` record near the top of the file (9 hex values)
- the week-over-week delta arrow inside `MonthlyOverview()` — `#1B8A4A` and `#A33A2A`, each
  appearing **twice** (once on the SVG's `stroke`, once on the `<span>`'s `style.color`)

**Diagnose before you edit.** The three *card* backgrounds are already almost exactly on-theme:
`#F7EEE8 ≈ orange-50`, `#EEF0EA ≈ green-50`, `#ECEFF2 ≈ blue-50`. The clash is coming from
**(a) the small rounded icon tiles** — `#E2F4E7` is a mint green and `#E4EEFA` is a baby blue,
neither of which exists anywhere else in this product — and **(b) the vivid glyph colours**
`#1E7A46` and `#2F6AD1`. Correct those hard; leave the card tints to a gentle nudge. Over-correcting
the cards will flatten the row into three grey rectangles, which is the failure mode to avoid.

### Offender B — the floating notification ticker (the three gliding strips)

`src/components/NotificationTicker.module.css`

- `.strip` — the `--strip-bg` / `--strip-fg` defaults
- `.insight` — `#eef7e9` / `#16743e` (bright green)
- `.sync` — `#edf5ff` / `#1857a8` (bright blue)
- `.delivery` — `#fff1de` / `#96501e` (orange)

Touch **only** those four `--strip-bg` / `--strip-fg` declarations and the `outline` colour in
`.strip:focus-visible` (which already reads `var(--strip-fg)` — so it fixes itself and needs no
edit). Everything else in that stylesheet — the `--ticker-*` variables, the mask, the gradient
stops, `opacity: 0.9`, the keyframes, the media queries, the reduced-motion block — is off-limits.

### Offender C — the Health Score card (the green bar)

`src/app/artisan/dashboard/page.tsx`, inside `TrustAndReportsCard`, **lines ~1162–1215 only**.
Every raw hex in this entire file lives in that range, so it is a self-contained target:

| Line | Current | What it is |
|--:|:--|:--|
| 1162 | `bg-[#F2EFE9]` / `border-[#E8E4DB]` | the card itself |
| 1176 | `bg-[#E8E2D5]` | progress-bar track |
| 1178 | `bg-[#245C42]` | **the green bar fill** |
| 1188, 1195, 1202 | `bg-[#E5DFD1]` | the three GPB / UPLOADED / RECOGNIZED blocks |
| 1189 | `text-[#245C42]` | ShieldCheck glyph |
| 1196 | `text-[#36494E]` | CloudUpload glyph |
| 1203 | `text-[#8C5A35]` | Award glyph |
| 1213 | `bg-[#E4EACD]` | the insights pill under the bar |
| 1215 | `text-[#4B6B38]` | Leaf glyph in that pill |

The upheld-reports list below it already uses `border-red-100 bg-red-50` — **theme tokens, already
correct. Leave it alone.**

---

## 4. THE MAPPING — APPLY EXACTLY THIS

### 4.1 Offender A — `MonthlyOverview.tsx`

```ts
/**
 * Card, icon tile and icon colours for each metric.
 *
 * Hex rather than `var(--color-…)` because these values are handed to the SVG
 * icons as a `fill` / `stroke` PRESENTATION ATTRIBUTE, which does not resolve
 * CSS custom properties. Each one therefore MIRRORS a token from
 * src/app/globals.css and must be changed only in step with it.
 */
const TONES: Record<Tone, { card: string; tile: string; icon: string }> = {
  // --color-orange-50 · a lighter step of it · --color-stat-orange
  craft:   { card: "#FBEDE3", tile: "#FDF7F2", icon: "#C2632F" },
  // --color-green-50 · a lighter step of it · --color-stat-teal
  verify:  { card: "#EFF0E8", tile: "#F8F8F5", icon: "#4A5241" },
  // --color-blue-50 · a lighter step of it · --color-stat-blue
  schemes: { card: "#E9EDF0", tile: "#F5F7F8", icon: "#4D5D6C" },
};
```

Each `tile` is its own `card` mixed 55 % toward white — one clear step lighter, same hue family, so
the glyph still sits on a plate rather than floating. Do not substitute plain white or a grey.

Delta arrow, both occurrences of each:

| Current | New | Token mirrored |
|:--|:--|:--|
| `#1B8A4A` (up) | `#49523E` | `--color-green-600` |
| `#A33A2A` (down) | `#8C2B22` | `--color-red-500` |

### 4.2 Offender B — `NotificationTicker.module.css`

CSS modules resolve global custom properties normally, so here you **do** use the token form:

```css
.strip {
  --strip-bg: var(--color-green-50);    /* was #eef7e9 */
  --strip-fg: var(--color-green-700);   /* was #16743e */
  /* …everything else in this rule is untouched… */
}

.insight  { --strip-bg: var(--color-green-50);  --strip-fg: var(--color-green-700); }
.sync     { --strip-bg: var(--color-blue-50);   --strip-fg: var(--color-blue-700); }
.delivery { --strip-bg: var(--color-orange-50); --strip-fg: var(--color-orange-700); }
```

Resolved: green `#EFF0E8` / `#3C4433` · blue `#E9EDF0` / `#37424D` · orange `#FBEDE3` / `#94481F`.

The three strips stay **distinguishable** — olive, slate and terracotta are three different hue
families — but none of them shouts. That is the point: they should register as a texture at the top
of the page, not as three traffic lights.

### 4.3 Offender C — `TrustAndReportsCard` in `dashboard/page.tsx`

| Line | Current | New |
|--:|:--|:--|
| 1162 | `bg-[#F2EFE9]` | `bg-[var(--color-gray-100)]` |
| 1162 | `border-[#E8E4DB]` | `border-[var(--color-gray-200)]` |
| 1176 | `bg-[#E8E2D5]` | `bg-[var(--color-gray-200)]` |
| 1178 | `bg-[#245C42]` | `bg-[var(--color-green-600)]` — **see §6.2 before you accept this** |
| 1188/1195/1202 | `bg-[#E5DFD1]` | `bg-[var(--color-gray-200)]` |
| 1189 | `text-[#245C42]` | `text-[var(--color-green-600)]` |
| 1196 | `text-[#36494E]` | `text-[var(--color-stat-blue)]` |
| 1203 | `text-[#8C5A35]` | `text-[var(--color-yellow-700)]` |
| 1213 | `bg-[#E4EACD]` | `bg-[var(--color-green-100)]` |
| 1215 | `text-[#4B6B38]` | `text-[var(--color-green-600)]` |

Most of these are near-identical swaps — `#F2EFE9 → #F1EDE6`, `#E8E4DB → #E4DED5`,
`#E8E2D5 → #E4DED5` — deliberately so. The card was already roughly right; it is the **bar fill**
and the **yellow-green insights pill** that break the palette. Do not use the near-identity of the
others as licence to redesign them.

---

## 5. TWO TECHNICAL TRAPS THAT WILL SILENTLY BREAK THIS

### 5.1 `var()` does not work in an SVG presentation attribute

`<svg fill="var(--color-stat-orange)">` and `<path stroke="var(--color-green-600)">` **do not
render**. Presentation attributes are not CSS declarations and browsers will not resolve `var()` in
them — the glyph comes out black, or unstroked, with **no error and no warning**. You will not catch
this in the terminal; only by looking at the page.

This is why §4.1 keeps `TONES` as hex literals with a comment naming the token each mirrors. It is a
deliberate, documented exception to the repo's "never a raw hex" rule, not an oversight.

The same applies to the delta arrow, which currently uses `stroke={...}` as an attribute. Keep
passing it a hex string. **If** you would rather use tokens there, the only correct form is an
inline style — `style={{ stroke: "var(--color-green-600)" }}` — or a Tailwind arbitrary class
`stroke-[var(--color-green-600)]`. Never the bare attribute. Given the "change nothing but values"
brief, **the hex swap is the preferred answer**; do not restructure the arrow to prove a point.

### 5.2 Tailwind v4 arbitrary values with `var()` inside `page.tsx`

`bg-[var(--color-green-600)]` and `text-[var(--color-stat-blue)]` are valid Tailwind v4 arbitrary
values and compile fine — the file already uses this exact form elsewhere (e.g.
`bg-[var(--color-background)]` in `src/app/artisan/layout.tsx`). Use it. Do **not** invent
`bg-green-600` shorthand hoping it maps; verify each class actually renders the expected colour in
DevTools rather than assuming.

---

## 6. THE TWO JUDGEMENT CALLS — DECISION LADDERS, NOT GUESSES

Everything above is mechanical. These two need your eyes on the running page.

### 6.1 Are the "verify" and "schemes" glyphs still telling each other apart?

`--color-stat-teal #4A5241` (olive) and `--color-stat-blue #4D5D6C` (slate) are both dark and
desaturated by design. At 26–30 px they should still separate, helped by the different card tints
and the different icon shapes — but **look at the actual row at 100 % zoom on a 1440 px screen
before accepting it.**

If they genuinely read as the same colour:

1. **First** try `--color-green-700 #3C4433` for `verify` — darker, pushes it away from the slate.
2. **Only if that fails**, move `schemes` to `--color-stat-brown #9A7B3F` with its card at
   `--color-yellow-50 #F6EEDD` and tile at `#FBF7EE`.
3. **Never** reach for a saturated colour to solve this. In this palette, differentiation comes from
   the **card tint and the glyph shape**, not from turning the hue up.

### 6.2 The health bar fill under `mix-blend-color-burn`

This is the one change with real visual risk, and the one the user cares most about.

The bar is a coloured fill with a repeating texture layered over it at `mix-blend-color-burn` and
`opacity-60`. **Colour-burn darkens hard.** The current `#245C42` is a mid-dark, fairly saturated
forest green that survives it. `--color-green-600 #49523E` is both darker and far less saturated, so
the burn may crush the whole bar toward black — at which point it stops reading as a health score
and starts reading as a broken element.

Work the ladder, in order, and **stop at the first rung that passes the acceptance test**:

1. `bg-[var(--color-green-600)]` **#49523E** — try this first.
2. If the bar crushes: `bg-[var(--color-green-500)]` **#566049** — lighter olive, still fully
   on-theme, still a pure colour-value change.
3. If *that* still crushes: `bg-[var(--color-green-400)]` **#7C8468**.
4. **Last resort only**, and only if rungs 1–3 all fail: lower the overlay's `opacity-60` to
   somewhere in `opacity-40`–`opacity-50`. This is the single place you are permitted to touch a
   non-colour value, it must be the minimum that works, and you must call it out explicitly in your
   report as a deviation from the "colours only" brief.

**Acceptance test for the bar** — all four must hold:

- the filled portion is obviously distinguishable from the `--color-gray-200` track beside it;
- the filled portion is obviously distinguishable from `--color-primary #1A1A1A` (it must read as a
  colour, not as black);
- the droodle texture is still **visible but subordinate** — present as a grain, not as noise
  competing with the fill;
- at 96/100 the bar looks confident and healthy, not muddy, not sickly.

**Alternative worth rendering before you commit:** the theme's own comment assigns terracotta to
*"artisan share, verified dot, up-trends"*. A health score is an up-signal, so `--color-rust
#C2632F` is an equally legitimate — arguably warmer and better-blended — choice for this bar, and it
takes colour-burn beautifully. **Render both the olive and the rust version, screenshot each, and
put both in your report for the human to pick.** Default to olive if you must ship one, because it
preserves the existing green semantic; but do not decide this silently.

---

## 7. VERIFICATION

### 7.1 Automated gates — all must be clean

```bash
cd KARIGARI-main/KARIGARI
npx tsc --noEmit
npm run lint
npm run build
```

A pure colour change must not move any of these. If one breaks, you edited something you shouldn't
have — revert and start again rather than patching around it.

### 7.2 The diff test — the strongest check in this document

```bash
git diff --stat
git diff
```

- `--stat` must list **exactly three files**: `MonthlyOverview.tsx`,
  `NotificationTicker.module.css`, `dashboard/page.tsx`.
- Every single line in `git diff` must be a colour value. If any hunk touches a class name, a tag,
  an attribute, a number, a word of copy, or whitespace — **revert that hunk.** There is no
  acceptable exception except §6.2 rung 4.
- Read the full diff line by line before committing. Do not skim it.

### 7.3 Visual check — with `npm run dev` running, on `/artisan/dashboard`

- [ ] Screenshot **before and after** at 1440 px and at 360 px, and compare them side by side
- [ ] The three metric cards read as one family with the rest of the page — no mint, no baby blue,
      no vivid glyph anywhere
- [ ] The three metric cards are still **telling each other apart** (§6.1) and the row has not
      collapsed into three identical grey boxes
- [ ] The ticker strips are calm; all three are still distinguishable; the gliding motion, the
      stagger, the edge fade and the hover/focus behaviour are all **unchanged**
- [ ] The health bar passes all four points of the §6.2 acceptance test
- [ ] The insights pill under the bar no longer reads as yellow-green
- [ ] The GPB / UPLOADED / RECOGNIZED blocks sit correctly on the card — visible, not floating, not
      invisible against it
- [ ] Nothing has shifted by a pixel. Overlay the before/after screenshots if unsure — layout must
      be identical
- [ ] Tab through the ticker: focus outlines are visible and now inherit the new `--strip-fg`
- [ ] Zero new console warnings, zero errors
- [ ] Spot-check the dashboard in all four languages — no string changed, so nothing should differ
      except colour

### 7.4 Contrast — do not skip this

The ticker strips render at `opacity: 0.9` over the `#F6F3EE` canvas, so the effective contrast is
slightly lower than the raw pair suggests. Measure the **composited** text contrast for each strip
with DevTools:

| Strip | Pair | Expected (raw) |
|:--|:--|--:|
| `.insight` | `#3C4433` on `#EFF0E8` | ≈ 9.9 : 1 |
| `.sync` | `#37424D` on `#E9EDF0` | ≈ 9.5 : 1 |
| `.delivery` | `#94481F` on `#FBEDE3` | ≈ 5.7 : 1 |

All must stay **≥ 4.5 : 1** after compositing. `.delivery` has the least headroom — if it measures
below 4.5, darken its `--strip-fg` to `var(--color-orange-900)` **#5E2C12** and re-measure. Do not
solve a contrast failure by raising the strip's opacity; that is a design change.

Also check the metric-card labels (`text-gray-700`) and figures (`text-gray-900`) against their new
card tints — they were fine before and should stay fine, but confirm rather than assume.

---

## 8. REPORT AND COMMIT

Commit only once §7 is fully green:

```
style(dashboard): re-point metric cards, notification ticker and health score to theme tokens
```

Then report, briefly:

1. The three files and the exact number of values changed in each.
2. Which rung of the §6.2 ladder the health bar landed on, and why.
3. **Both** health-bar screenshots (olive and rust) for the human to choose between.
4. Whether §6.1 needed its fallback, and what you saw.
5. The four measured contrast ratios.
6. Any place outside these three files where you noticed similar off-theme hex — **named only, not
   touched** — so the human can decide separately.
7. Confirmation, in one line, that `git diff` contains colour values and nothing else.

---

## 9. IF YOU ARE TEMPTED TO DO MORE

Don't. The person who wrote this brief said it three separate ways: *"just the colors only"*,
*"without changing anything else"*, *"not even the design inside the green bar"*.

A colour pass that also "improves" the spacing is a failed colour pass, because it becomes
impossible to tell which change caused which visual difference. If you spot something genuinely
worth fixing, **write it in the report and leave the code alone.**

---

*End of prompt. One pass, three files, colour values only.*
