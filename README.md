# FemFast site

The marketing site and check-in funnel for [femfast.io](https://femfast.io).

Six routes, all static: `/`, `/checkin/`, `/help/`, `/contact/`, `/privacy/`,
`/terms/`.

```bash
npm ci
npm run build      # /src + /data -> /dist
npm run check      # drive the built site and assert it behaves
npm run verify     # screenshot-diff /dist against the original export
npm run lighthouse # audit all six routes, mobile and desktop
npm run contrast   # worst-case WCAG contrast for the translucent body ink
```

`npm run build` needs a Chromium (see [Requirements](#requirements)).

---

## Why there is a build step

The site started as a component export that rendered itself in the browser: a
template language with `{{ }}` bindings, driven by `src/support.js`, a React
runtime that fetched React from unpkg.com at page load. That meant the page
was blank until three third-party scripts arrived, the `<head>` tags social
scrapers read were never in the HTML, and there was no content at all without
JavaScript.

`scripts/build.mjs` runs that same runtime **once, at build time**, in
headless Chromium with React vendored locally. It captures the rendered DOM
and the CSS the runtime generated, and writes plain HTML into `/dist` with a
real `<head>`. No React, no `support.js`, no CDN in the output.

Capturing the markup from the real renderer — rather than transcribing it —
is what makes the output pixel-identical to the export. `npm run verify`
proves it.

---

## Layout

```
data/           the site's content, edit these rather than markup
  phases.json     every cycle-phase value + the check-in's override copy
  reviews.json    App Store reviews, rendered verbatim
  rating.json     rating figures — manual, see the note inside
src/
  site.config.mjs routes, titles, descriptions, redirects
  plan.js         the check-in's logic (shared, see below)
  app.js          all client behaviour, vanilla, the only script shipped
  landing.part.html / checkin.part.html / sticky.part.html
  *.page.html     help, contact, privacy, terms
  SiteFooter.dc.html / PhaseWheel.dc.html   inlined at build time
  logic.js        the component behind the landing page and check-in
  support.js      the original runtime — build-time only, never shipped
scripts/
  build.mjs       prerender + emit
  check.mjs       functional gate
  verify.mjs      screenshot diff against the export
  lighthouse.mjs  audits
  contrast.mjs    glyph-level contrast measurement
legal/          Privacy and Terms as markdown, plus the Tilda meta note
reference/      the original export, frozen, only so verify has a baseline
dist/           build output — this is what gets served
```

### One source for the check-in's logic

`src/plan.js` holds the questions and the plan a set of answers produces. It
is not imported twice or copied: the build inlines it **both** into the
component it prerenders with **and** into the shipped `app.js`. The static
render and the live check-in therefore run the same code, which is what keeps
the 12:12 fasting floor, the overrides and the "Adjusted for" chips and tags
identical to the original.

The build refuses to emit anything if the floor is violated — it checks every
phase × goal × fasting × training × diet combination first.

### One source for phase values

Every phase value — fasting windows, food, training, supplements, day ranges,
descriptions, colours — lives in `data/phases.json`. The wheel, the timeline
section, the hero phone mockup and the check-in result all read from it, and
none of those values appears in markup or JS. `npm run check` asserts the
follicular plan reads identically in all four places.

To change what the site says about a phase, edit that file and rebuild.

---

## Editing

| To change | Edit |
|---|---|
| Any phase value | `data/phases.json` |
| What the check-in substitutes for an override | `data/phases.json` → `planOverrides` |
| The reviews section | `data/reviews.json` |
| The rating line | `data/rating.json` |
| Titles, descriptions, OG tags, redirects | `src/site.config.mjs` |
| Page copy and layout | the matching file in `src/` |
| Client behaviour | `src/app.js` |

After any edit: `npm run build && npm run check && npm run verify`.

`verify` will flag it if a change moved something visually — that is the
point. If the change was intentional, the diff images in `.build/diff/` show
exactly what moved.

---

## Quality gates

`npm run check` (31 assertions) covers: all six routes returning 200, every
internal link resolving, no console errors, nothing clipped or overflowing at
390px, the follicular plan identical in all four places, and the check-in's
step counter, override chips, row tags, phase badge and fasting floor.

`npm run verify` screenshots every route at 1440 and 390 against the frozen
export and diffs them. A same-page-twice control diffs at zero pixels, so any
figure it reports is real rather than measurement noise.

`/help/`, `/contact/`, `/privacy/` and `/terms/` are byte-identical to the
export. `/` and `/checkin/` now differ on purpose: body copy was darkened from
`rgba(69,55,72,0.6)` to `0.74` for contrast, and the mobile CTA reads "Start
the check-in" rather than "Start". That accounts for 0.22%/0.47% on the
landing page and 0.02%/0.06% on the check-in. Page dimensions are unchanged at
both widths, so neither edit moved the layout.

Before those two edits the figure was 0.001% — sub-pixel anti-aliasing inside
the hero phone mockup, which rasterises in a CSS `perspective` layer at
fractional coordinates. That remains the floor for the untouched pixels.

`npm run lighthouse` audits all six routes on both form factors. Everything
scores 100 except the landing page, which is 93/100 performance
(mobile/desktop) and 96 accessibility.

`npm run contrast` is the audit behind that accessibility number. Body copy is
`rgba(69,55,72,α)` — semi-transparent — so what lands on screen depends on what
is behind it, and behind the hero is a WebGL shader painting a gradient rather
than a flat colour. The script therefore assumes no background: for each
element it screenshots the box twice, once rendered and once with every glyph
hidden, treats the differing pixels as the glyphs, and composites the ink over
the darkest backdrop *at those pixels*. Sampling the whole box instead would
fail text that is perfectly legible, because an element's box routinely
overlaps something darker the letters never touch — the hero caption's box
catches the phone's drop shadow.

Three contrast findings remain on the landing page, none of them body copy:

- the phone mockup's supplements overlay, `#8A8790` at 10.4px — an opaque
  colour that mimics the app's own UI inside the screenshot
- the caption under the phone, `rgba(69,55,72,0.55)` — a lighter alpha than
  the body ink, sitting partly in the phone's drop shadow, which measures
  2.44:1 against the darkest pixel its glyphs touch
- a paragraph caught mid-scroll-reveal, where the `[data-reveal]` animation's
  partial opacity lightens the text for as long as it is animating

The landing page also reports `label-content-name-mismatch`: the mobile CTA
reads "Start the check-in" while its `aria-label` is "Take the 60-second
check-in", and WCAG 2.5.3 wants the accessible name to contain the visible
text. Making the `aria-label` begin with the visible words clears it.

Pass a URL to audit a deployment instead of the local build:

```bash
npm run lighthouse -- https://femfast.io
```

---

## Requirements

Node 18+, and a Chromium for the build and the gates. In an environment where
Playwright's browsers are pre-installed, point at it:

```bash
export CHROME_PATH=/path/to/chrome
```

Otherwise `npx playwright install chromium` once.

---

## Deploying

See [CUTOVER.md](CUTOVER.md) — it covers publishing to GitHub Pages, the
Cloudflare DNS change, verification and rollback. The repository and both
branches exist; no DNS change has been made and no custom domain is set, so
the live Tilda site is untouched.
