# FemFast site

The marketing site and check-in funnel for [femfast.io](https://femfast.io).

Six routes, all static: `/`, `/checkin/`, `/help/`, `/contact/`,
`/privacypolicy`, `/termsofuse`.

The two legal paths are the addresses in the App Store listing, which is why
they are spelled that way. They are the pages themselves — 200, with a
canonical tag pointing at themselves — not redirects. `/privacy/` and
`/terms/` were this site's own paths for a while and now redirect to them.

```bash
npm ci
npm run build      # /src + /data -> /dist
npm run check      # drive the built site and assert it behaves
npm run verify     # screenshot-diff /dist against the original export
npm run lighthouse # audit all six routes, mobile and desktop
npm run contrast   # worst-case WCAG contrast for the translucent body ink
npm run deploy     # publish /dist to gh-pages, preserving the custom domain
npm run urls       # path -> status -> final URL for every address that matters
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
  deploy.mjs      publish to gh-pages without losing the CNAME
  urls.mjs        resolve every address, locally or against a deployed site
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

`npm run check` (52 assertions) covers: all six routes returning 200, every
internal link resolving, no console errors, nothing clipped or overflowing at
390px, the follicular plan identical in all four places, and the check-in's
step counter, override chips, row tags, phase badge and fasting floor. It
also covers the legal URLs specifically: `/privacypolicy` and `/termsofuse`
each answering 200 in both bare and trailing-slash form with the right
canonical, their text matching the source verbatim paragraph for paragraph,
`/privacy/` and `/terms/` landing on them, and no internal link still
pointing at the old paths.

`npm run verify` screenshots every route at 1440 and 390 against the frozen
export and diffs them. A same-page-twice control diffs at zero pixels, so any
figure it reports is real rather than measurement noise.

`/help/`, `/contact/`, `/privacypolicy` and `/termsofuse` are byte-identical to the
export. `/` and `/checkin/` now differ on purpose: body copy was darkened from
`rgba(69,55,72,0.6)` to `0.74` for contrast, and the mobile CTA reads "Start
the check-in" rather than "Start". That accounts for 0.22%/0.47% on the
landing page and 0.02%/0.06% on the check-in. Page dimensions are unchanged at
both widths, so neither edit moved the layout.

Before those two edits the figure was 0.001% — sub-pixel anti-aliasing inside
the hero phone mockup, which rasterises in a CSS `perspective` layer at
fractional coordinates. That remains the floor for the untouched pixels.

`npm run lighthouse` audits all six routes on both form factors. Everything
scores 100 except the landing page: 96 accessibility, and mobile performance
which lands between 90 and 93 depending on the run (LCP varies under the
emulated throttling). Desktop is 100 across the board.

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

Two contrast findings remain on the landing page, both deliberate:

- the phone mockup's supplements overlay, `#8A8790` at 10.4px. That is an
  opaque colour imitating the app's own UI *inside* the screenshot, not site
  chrome, so it is left alone.
- two paragraphs caught mid-scroll-reveal. They sit inside `[data-reveal]`,
  whose entry animation ramps opacity, and axe happened to sample while it was
  running. At rest their effective opacity is 1.0 and they measure 4.97:1 —
  the audit is catching a frame, not a static colour.

`npm run contrast` is stricter than axe, because it measures painted pixels
rather than the computed CSS background. By that measure the caption under the
phone ("Evelyn's Day 8…") is still 3.51:1: its glyphs fall inside the phone's
drop shadow, which takes the backdrop to `#C6BCBD` — nowhere near cream. No
alpha fixes that cheaply; the ink would have to go to ~0.90 to clear 4.5:1
against that shadow, and even fully opaque only reaches 5.98:1.

Body copy is `rgba(69,55,72,0.74)` throughout. On flat cream that clears AA
everywhere except `#FFDDD0`, the very end of the hero gradient, where it is
4.44:1; `0.75` would clear it.

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

The site is live at <https://femfast.io>, served by GitHub Pages from the
`gh-pages` branch of
[`femfast-site`](https://github.com/Liubov-personal-use/femfast-site).
`www.femfast.io` redirects to it.

Publish a change with:

```bash
npm run build && npm run check && npm run verify
npm run deploy
```

**Always `npm run deploy`; never rebuild `gh-pages` by hand.** A custom domain
on GitHub Pages is stored as a `CNAME` file *in the served branch*, so any
publish that rebuilds the branch from `/dist` deletes it and silently takes
the site off its domain. `deploy.mjs` reads the domain already on the remote
branch and writes it back on every push. `--dry-run` shows what would change.

[CUTOVER.md](CUTOVER.md) records the move from Tilda: the DNS that is now in
place, the rollback while Tilda is still alive, and the one step outstanding —
deleting the `staging.femfast.io` record, which 404s now that the custom domain
has moved.

Verify a deployment with:

```bash
npm run urls -- https://femfast.io
```
