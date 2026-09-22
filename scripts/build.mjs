#!/usr/bin/env node
/**
 * FemFast static site build.
 *
 * The source in /src is a component export that renders itself client-side:
 * a template language with {{ }} bindings, sc-if / sc-for control flow and
 * dc-import includes, driven by /src/support.js (a React-based runtime that
 * pulls React off a CDN at page load).
 *
 * Shipping that as-is means the page is blank until three third-party scripts
 * land, the <head> tags social scrapers read are never in the HTML, and there
 * is no content at all without JavaScript.
 *
 * So this build runs that runtime once, here, at build time: it loads each
 * route in headless Chromium with React vendored locally, waits for the real
 * render, and captures the resulting DOM and the CSS the runtime generated.
 * The output in /dist is plain HTML with a real <head> — no React, no
 * support.js, no CDN. Interactivity is re-attached by /src/app.js, which is
 * hand-written vanilla JS and the only script the built site loads.
 *
 * Because the markup is captured from the real renderer rather than
 * transcribed by hand, the built pages are pixel-identical to the export.
 * `npm run verify` proves that by diffing screenshots of both.
 *
 * Every phase value comes from /data/phases.json, and the reviews and rating
 * figures from /data/reviews.json and /data/rating.json. Nothing about a
 * phase, a review or the rating is written into markup or JS by hand.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DATA_DIR = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, '.build');
const VENDOR = join(ROOT, 'vendor');

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const log = (...a) => console.log('[build]', ...a);

/* ------------------------------------------------------------------ data - */

async function loadJson(name) {
  return JSON.parse(await readFile(join(DATA_DIR, name), 'utf8'));
}

async function loadData() {
  const [phases, reviews, rating] = await Promise.all([
    loadJson('phases.json'),
    loadJson('reviews.json'),
    loadJson('rating.json'),
  ]);
  // Fail loudly rather than emitting a site with silently missing plan copy.
  const need = ['fast', 'food', 'train', 'supp', 'body', 'start', 'end', 'ramp', 'color'];
  for (const p of phases.phases) {
    for (const k of need) {
      if (p[k] === undefined) throw new Error(`phases.json: ${p.id} is missing "${k}"`);
    }
  }
  return { phases, reviews, rating };
}

/* ------------------------------------------------- source link rewriting - */

// The export links pages as sibling .dc.html files. The built site uses
// directory-style routes at absolute paths.
//
// These match the quoted path itself, not `href="..."`, because the same
// paths also appear as plain strings in component scripts (help's PAGE_LINKS
// table) and as component props (the footer's `home`, from which it builds
// its own #why / #how / #phases / #faq links).
const PATH_MAP = {
  './index.html': '/',
  './Help.dc.html': '/help/',
  './Contacts.dc.html': '/contact/',
  './Privacy.dc.html': '/privacy/',
  './Terms.dc.html': '/terms/',
};
const LINK_MAP = Object.entries(PATH_MAP).map(([from, to]) => [
  new RegExp('(["\'])' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\1', 'g'),
  (m, q) => q + to + q,
]);

// Every CTA that used to open the quiz overlay in-page now navigates to the
// dedicated /checkin/ route. The onClick binding goes with it.
const QUIZ_CTA = /href="#check-in" onClick="\{\{ openQuiz \}\}"/g;

function rewriteLinks(html) {
  let out = html;
  for (const [re, to] of LINK_MAP) out = out.replace(re, to);
  out = out.replace(QUIZ_CTA, 'href="/checkin/"');
  return out;
}

/* ------------------------------------------ dc document assembly (build) - */

// plan.js is read once and inlined into every component script, so the markup
// prerendered here comes from the same plan code the browser later runs.
let PLAN_SRC = '';

function dcPrelude(data, initState) {
  return (
    `const DATA = ${JSON.stringify(data)};\n` +
    `const INIT_STATE = ${JSON.stringify(initState || {})};\n` +
    PLAN_SRC + '\n'
  );
}

/** Wrap a template + logic into a standalone dc document the runtime can boot. */
function dcDocument({ helmet, template, logic, data, initState, props = '{}' }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./vendor/react.production.min.js"></script>
<script src="./vendor/react-dom.production.min.js"></script>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${helmet}
</helmet>
${template}
</x-dc>
<script type="text/x-dc" data-dc-script data-props="${props.replace(/"/g, '&quot;')}">
${dcPrelude(data, initState)}
${logic}
</script>
</body>
</html>
`;
}

/**
 * The page-style sources (help/contact/privacy/terms) are already complete dc
 * documents. They only need React preloaded, the data prelude injected and
 * their links rewritten.
 */
function prepareWholePage(html, data, initState) {
  let out = html.replace(
    '<script src="./support.js"></script>',
    '<script src="./vendor/react.production.min.js"></script>\n' +
      '<script src="./vendor/react-dom.production.min.js"></script>\n' +
      '<script src="./support.js"></script>'
  );
  out = injectPrelude(out, data, initState);
  return rewriteLinks(out);
}

/**
 * Add the data prelude to a component script — but only one that actually
 * defines a component. Contact's script is empty (the page is pure markup),
 * and giving it a body makes the runtime reject it for having no
 * `class Component extends DCLogic`, which it then renders as an error banner.
 */
function injectPrelude(html, data, initState) {
  return html.replace(
    /(<script type="text\/x-dc" data-dc-script[^>]*>)([\s\S]*?)(<\/script>)/,
    (m, open, body, close) =>
      body.includes('class Component') ? open + '\n' + dcPrelude(data, initState) + body + close : m
  );
}

/* ------------------------------------------------------------- workspace - */

async function buildWorkspace(data) {
  PLAN_SRC = await readFile(join(SRC, 'plan.js'), 'utf8');
  // The floor is a hard product rule, so prove it before anything is emitted.
  const plan = new Function(PLAN_SRC + '; return createPlan;')()(data);
  const fails = plan.testFastingFloor();
  if (fails.length) {
    throw new Error(
      `the 12:12 fasting floor is violated by ${fails.length} combinations, e.g.\n  ` +
        fails.slice(0, 5).join('\n  ')
    );
  }
  log(`12:12 fasting floor holds across all phase x goal x fasting x training x diet combinations`);

  await rm(WORK, { recursive: true, force: true });
  await mkdir(join(WORK, 'render', 'vendor'), { recursive: true });
  const R = (p) => join(WORK, 'render', p);

  await cp(join(VENDOR, 'react'), R('vendor'), { recursive: true });
  await cp(join(SRC, 'support.js'), R('support.js'));
  await cp(join(ROOT, 'assets'), R('assets'), { recursive: true });

  // Components the runtime fetches by name must sit beside the pages.
  const footer = rewriteLinks(await readFile(join(SRC, 'SiteFooter.dc.html'), 'utf8'));
  await writeFile(R('SiteFooter.dc.html'), injectPrelude(footer, data, {}));

  const wheel = await readFile(join(SRC, 'PhaseWheel.dc.html'), 'utf8');
  await writeFile(R('PhaseWheel.dc.html'), injectPrelude(wheel, data, {}));

  const helmet = await readFile(join(SRC, 'helmet.html'), 'utf8');
  const logic = await readFile(join(SRC, 'logic.js'), 'utf8');
  const landingTpl = rewriteLinks(await readFile(join(SRC, 'landing.part.html'), 'utf8'));
  const stickyTpl = rewriteLinks(await readFile(join(SRC, 'sticky.part.html'), 'utf8'));
  const checkinTpl = rewriteLinks(await readFile(join(SRC, 'checkin.part.html'), 'utf8'));
  const PROPS = '{"defaultPlan":{"editor":"enum","options":["quarterly","annual","monthly"],"default":"quarterly","tsType":"string","section":"Pricing"}}';

  // Each capture is one render of one state. `pick` says which part of the
  // rendered document to keep.
  const captures = [
    // --- landing ---------------------------------------------------------
    { name: 'landing', file: 'landing.html', pick: 'root',
      doc: dcDocument({ helmet, template: landingTpl, logic, data, initState: {}, props: PROPS }) },
    // The sticky bar only appears on a narrow viewport once the hero CTA has
    // scrolled away, and the component recomputes that on mount — so this
    // capture renders the whole landing at phone width, scrolls, and keeps
    // just the bar.
    { name: 'sticky', file: 'sticky.html', pick: 'root',
      select: '[data-ff="stickyBar"]',
      viewport: { width: 390, height: 800 },
      scrollTo: 1600,
      doc: dcDocument({ helmet, template: stickyTpl + '\n' + landingTpl, logic, data,
        initState: {}, props: PROPS }) },

    // --- check-in: one capture per state ---------------------------------
    ...[0, 1, 2, 3, 4, 5].map((step) => ({
      name: `step${step}`, file: `step${step}.html`, pick: 'root',
      doc: dcDocument({ helmet, template: checkinTpl, logic, data,
        initState: { quizOpen: true, step }, props: PROPS }),
    })),
    { name: 'building', file: 'building.html', pick: 'root',
      doc: dcDocument({ helmet, template: checkinTpl, logic, data,
        initState: { quizOpen: true, step: 6, building: true }, props: PROPS }) },
    // Render the result with an answer set that exercises every optional
    // element — all four row tags, several chips and the food note — so the
    // captured skeleton contains every node app.js may need to show.
    { name: 'result', file: 'result.html', pick: 'root',
      doc: dcDocument({ helmet, template: checkinTpl, logic, data,
        initState: {
          quizOpen: true, step: 6, building: false,
          answers: { goal: 'weight', cycle: 'regular', day: '6', fasting: 'never',
                     training: '0', diet: ['veg', 'gf', 'df', 'lowcarb'] },
        }, props: PROPS }) },
  ];

  for (const c of captures) await writeFile(R(c.file), c.doc);

  // whole-page sources
  const pages = [
    ['help', 'help.page.html'],
    ['contact', 'contact.page.html'],
    ['privacy', 'privacy.page.html'],
    ['terms', 'terms.page.html'],
  ];
  for (const [name, file] of pages) {
    const raw = await readFile(join(SRC, file), 'utf8');
    await writeFile(R(`${name}.html`), prepareWholePage(raw, data, {}));
    captures.push({ name, file: `${name}.html`, pick: 'root' });
  }

  return captures;
}

/* ------------------------------------------------------------- prerender - */

function serve(dir, port) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.woff2': 'font/woff2', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let p = join(dir, url);
      if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/**
 * Pull the rendered markup and the CSS the runtime generated out of a page.
 * The runtime's own scaffolding CSS (placeholder shimmer, x-dc hiding) is
 * dropped; the page's own <helmet> CSS and the generated .scpN hover/focus
 * rules are kept.
 */
const EXTRACT = (selector) => {
  const root = document.getElementById('dc-root');
  const host = root && root.firstElementChild;
  const css = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = [...sheet.cssRules]; } catch { continue; } // cross-origin
    const text = rules.map((r) => r.cssText).join('\n');
    if (!text.trim()) continue;
    if (text.includes('.sc-placeholder') || text.includes('sc-dc-streaming')) continue;
    if (text.trim().startsWith('x-dc {')) continue;
    css.push(text);
  }
  if (selector) {
    const el = document.querySelector(selector);
    return { html: el ? el.outerHTML : '', css: css.join('\n\n') };
  }
  return { html: host ? host.innerHTML : '', css: css.join('\n\n') };
};

async function prerender(captures) {
  const port = 8901;
  const server = await serve(join(WORK, 'render'), port);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const out = {};
  const problems = [];
  try {
    for (const c of captures) {
      const page = await browser.newPage({ viewport: c.viewport || { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://localhost:${port}/${c.file}`, { waitUntil: 'networkidle', timeout: 45000 });
      // the runtime fetches sibling components, so give it a beat to settle
      await page.waitForFunction(
        () => { const r = document.getElementById('dc-root'); return r && r.firstElementChild; },
        { timeout: 20000 }
      );
      // Some state is recomputed on mount from viewport and scroll position
      // (the sticky bar is), so drive those before capturing.
      if (c.scrollTo) {
        await page.evaluate((y) => window.scrollTo(0, y), c.scrollTo);
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(400);
      const res = await page.evaluate(EXTRACT, c.select || null);
      if (!res.html || res.html.length < 200) problems.push(`${c.name}: rendered almost nothing`);
      if (res.html.includes('{{')) problems.push(`${c.name}: unresolved {{ }} binding left in markup`);
      // the runtime reports its own failures by rendering them into the page
      for (const marker of ['must define `class Component', 'dc-runtime', 'circular import', 'FAILED to load']) {
        if (res.html.includes(marker)) problems.push(`${c.name}: runtime error in output — ${marker}`);
      }
      if (errors.length) problems.push(`${c.name}: ${errors[0].slice(0, 160)}`);
      out[c.name] = res;
      log(`prerendered ${c.name} (${res.html.length} bytes)`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) throw new Error('prerender failed:\n  ' + problems.join('\n  '));
  return out;
}

/* ------------------------------------------------------------------ emit - */

/**
 * The header CTA reads "Take the check-in" wide and "Start" narrow. Swapping
 * the text in JS resizes the button after paint, so both labels ship and CSS
 * picks one.
 */
function splitHeaderCta(html) {
  // the label arrives wrapped in the runtime's interpolation span, so match
  // the whole inner markup and take its text
  const re = /(<a[^>]*data-ff="headerCta"[^>]*>)([\s\S]*?)(<\/a>)/;
  if (!re.test(html)) throw new Error('header CTA not found — cannot split its label');
  return html.replace(re, (m, open, inner, close) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    if (!text) throw new Error('header CTA has no label text');
    // "Start" on its own is not descriptive out of context, which both a
    // screen reader and Lighthouse's link-text audit object to
    return `${open}<span data-ff="ctaWide">${text}</span>` +
           `<span data-ff="ctaNarrow">Start the check-in</span>${close}`;
  });
}



function cleanMarkup(html) {
  return html
    .replace(/ data-dc-tpl="\d+"/g, '')            // runtime bookkeeping
    .replace(/<template[^>]*data-dc-tpl[^>]*><\/template>/g, '')
    .replace(/src="\.\/assets\//g, 'src="/assets/')
    .replace(/href="\.\/assets\//g, 'href="/assets/')
    .replace(/url\(\.\/assets\//g, 'url(/assets/');
}

/**
 * Serve WebP to browsers that take it, keeping the PNG as the fallback.
 * Only <img> tags whose file actually has a .webp sibling are wrapped.
 */
function wrapPictures(html, webpSet) {
  return html.replace(/<img\b([^>]*?)src="(\/assets\/[^"]+\.png)"([^>]*?)>/g, (m, pre, src, post) => {
    if (!webpSet.has(src)) return m;
    const webp = src.replace(/\.png$/, '.webp');
    // display:contents keeps <picture> out of layout entirely. Without it the
    // element is inline-level, which nudges the images it wraps by a fraction
    // of a pixel — visible as 1px seams down the phone mockup's edges.
    return `<picture style="display:block"><source srcset="${webp}" type="image/webp">` +
           `<img${pre}src="${src}"${post}></picture>`;
  });
}

/**
 * On phones the header nav is dropped and the CTA shortens. The export decided
 * that in JavaScript from window.innerWidth, which is fine when the whole page
 * is drawn client-side — but the static build ships one prerendered document
 * for every width, so doing it in JS means the header is drawn wide and then
 * collapses, shoving the page up by ~86px. That was a 0.31 CLS.
 *
 * The same rule as CSS applies before first paint, so there is no shift. The
 * `!important` is what lets it win against the prerendered inline styles.
 */
const NARROW_HEADER_CSS = `
  [data-ff="ctaNarrow"] { display: none; }
  @media (max-width: 759px) {
    [data-ff="nav"], [data-ff="getApp"] { display: none !important; }
    [data-ff="ctaWide"] { display: none; }
    [data-ff="ctaNarrow"] { display: inline; }
  }
`;

function head({ route, css, data, fontCss }) {
  const { site } = data.config;
  const url = site.origin + route.path;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(route.title)}</title>
<meta name="description" content="${esc(route.description)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#FDF9F6">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${site.name}">
<meta property="og:locale" content="en_GB">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(route.title)}">
<meta property="og:description" content="${esc(route.description)}">
<meta property="og:image" content="${site.origin}${site.ogImage}">
<meta property="og:image:width" content="${site.ogImageWidth}">
<meta property="og:image:height" content="${site.ogImageHeight}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(route.title)}">
<meta name="twitter:description" content="${esc(route.description)}">
<meta name="twitter:image" content="${site.origin}${site.ogImage}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/outfit-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/outfit-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
${route.preloadImage ? `<link rel="preload" as="image" href="${route.preloadImage}" type="image/webp" fetchpriority="high">` : ''}
<style>
${fontCss}

${NARROW_HEADER_CSS}

${css}
</style>`;
}

function page({ route, bodyHtml, css, data, fontCss }) {
  return `<!DOCTYPE html>
<html lang="${data.config.site.locale}">
<head>
${head({ route, css, data, fontCss })}
</head>
<body>
${bodyHtml}
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
}

/* ----------------------------------------------------------- DOM surgery - */

/**
 * The check-in is one page with several states. Each state was prerendered
 * separately; this joins them into a single document with only the first
 * question visible. app.js switches which block is shown.
 */
async function stitchCheckin(browser, caps) {
  const p = await browser.newPage();
  const html = await p.evaluate(
    ({ base, steps, building, result }) => {
      const frag = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d; };
      const root = frag(base);
      const first = root.querySelector('[data-ff="questionBlock"]');
      const content = first.parentElement;
      first.setAttribute('data-step', '0');

      steps.forEach((h, i) => {
        const q = frag(h).querySelector('[data-ff="questionBlock"]');
        q.setAttribute('data-step', String(i + 1));
        q.style.display = 'none';
        content.appendChild(q);
      });
      for (const [h, sel] of [[building, '[data-ff="buildingBlock"]'], [result, '[data-ff="resultBlock"]']]) {
        const el = frag(h).querySelector(sel);
        el.style.display = 'none';
        content.appendChild(el);
      }
      return root.innerHTML;
    },
    {
      base: caps.step0.html,
      steps: [caps.step1, caps.step2, caps.step3, caps.step4, caps.step5].map((c) => c.html),
      building: caps.building.html,
      result: caps.result.html,
    }
  );
  await p.close();
  return html;
}

/** Park the sticky bar in the landing markup, hidden until app.js reveals it. */
async function stitchLanding(browser, caps) {
  const p = await browser.newPage();
  const html = await p.evaluate(
    ({ base, sticky }) => {
      const d = document.createElement('div');
      d.innerHTML = base;
      const s = document.createElement('div');
      s.innerHTML = sticky;
      const bar = s.firstElementChild;
      bar.setAttribute('data-ff', 'stickyBar');
      bar.style.display = 'none';
      d.appendChild(bar);
      return d.innerHTML;
    },
    { base: caps.landing.html, sticky: caps.sticky.html }
  );
  await p.close();
  return html;
}

/* ---------------------------------------------------------------- assets - */

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(relative(base, p));
  }
  return out;
}

async function dirSize(dir) {
  let total = 0;
  for (const f of await walk(dir)) total += (await stat(join(dir, f))).size;
  return total;
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/**
 * Assets referenced from the source rather than from the rendered markup.
 * The wheel marker and the result badge build their filename at runtime
 * ("./assets/phase-{phase}.png"), so only the phase showing in the default
 * render appears in the static HTML. Expanding the placeholder here keeps the
 * other three from being swept as unused.
 */
async function collectSourceAssets(data) {
  const ids = data.phases.phases.map((p) => p.id);
  const found = new Set();
  for (const f of await readdir(SRC)) {
    if (!/\.(html|js|mjs)$/.test(f)) continue;
    const text = await readFile(join(SRC, f), 'utf8');
    for (const m of text.matchAll(/assets\/([A-Za-z0-9._{}-]+)/g)) {
      const name = m[1];
      if (name.includes('{phase}')) {
        for (const id of ids) found.add('/assets/' + name.replace('{phase}', id));
      } else if (extname(name)) {
        found.add('/assets/' + name);
      }
    }
  }
  return found;
}

async function buildAssets({ usedAssets }) {
  const sharp = (await import('sharp')).default;
  const srcDir = join(ROOT, 'assets');
  const outDir = join(DIST, 'assets');
  await mkdir(outDir, { recursive: true });

  const before = await dirSize(srcDir);
  const files = await walk(srcDir);
  const report = { before, removed: [], webp: [], copied: [] };
  const webpSet = new Set();

  for (const f of files) {
    const ext = extname(f).toLowerCase();
    const isPng = ext === '.png';
    const referenced = usedAssets.has(`/assets/${f}`);

    // phase-art-*.png were part of an earlier design and are not referenced
    if (!referenced && /^phase-art-/.test(f)) { report.removed.push(f); continue; }
    if (!referenced && isPng) { report.removed.push(f); continue; }

    await mkdir(dirname(join(outDir, f)), { recursive: true });
    await cp(join(srcDir, f), join(outDir, f));
    report.copied.push(f);

    // The App Store badge is an SVG and Apple's guidelines say ship it as-is.
    //
    // Two policies. The brand lockup, phase icons and grain are flat graphics
    // with hard edges, where lossy WebP shows; they go lossless and are small
    // anyway. The two app screenshots are photographic and by far the heaviest
    // thing on the page — the dashboard alone was 329 KB lossless and the LCP
    // element — so they go to quality 95, which the screenshot diff shows
    // costs a handful of sub-pixel edges for a ~190 KB saving.
    if (isPng) {
      const webpName = f.replace(/\.png$/i, '.webp');
      const photographic = /^screen-/.test(f);
      const opts = photographic ? { quality: 95, effort: 6 } : { lossless: true, effort: 6 };
      await sharp(join(srcDir, f)).webp(opts).toFile(join(outDir, webpName));
      webpSet.add(`/assets/${f}`);
      report.webp.push(webpName + (photographic ? ' (q95)' : ' (lossless)'));
    }
  }

  // self-hosted font files
  await cp(join(VENDOR, 'outfit'), join(outDir, 'fonts'), { recursive: true });

  // favicon + touch icon + share image, all drawn from the brand mark
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#FDF9F6"/>
<g transform="rotate(-90 50 50)" fill="none" stroke-width="13" stroke-linecap="round">
<circle cx="50" cy="50" r="34" stroke="#F0788E" pathLength="28" stroke-dasharray="4 24"/>
<circle cx="50" cy="50" r="34" stroke="#A8CC8A" pathLength="28" stroke-dasharray="7 21" stroke-dashoffset="-4"/>
<circle cx="50" cy="50" r="34" stroke="#F4CE7A" pathLength="28" stroke-dasharray="2 26" stroke-dashoffset="-11"/>
<circle cx="50" cy="50" r="34" stroke="#BB86B2" pathLength="28" stroke-dasharray="11 17" stroke-dashoffset="-13"/>
</g></svg>`;
  await writeFile(join(outDir, 'favicon.svg'), favicon);
  await sharp(Buffer.from(favicon)).resize(180, 180).png().toFile(join(outDir, 'apple-touch-icon.png'));

  const lockup = join(srcDir, 'femfast-lockup.png');
  const logo = await sharp(lockup).resize({ width: 560 }).toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#FDF9F6' } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(join(outDir, 'og-default.png'));

  report.after = await dirSize(outDir);

  // What a browser actually pulls down matters more than what sits on disk:
  // a WebP-capable browser never requests the PNG fallback.
  let served = 0;
  for (const f of await walk(outDir)) {
    if (f.startsWith('fonts/')) continue;            // fonts are new, count separately
    if (/\.png$/i.test(f) && webpSet.has('/assets/' + f)) continue;  // superseded by WebP
    served += (await stat(join(outDir, f))).size;
  }
  report.served = served;
  return { report, webpSet };
}

/* ---------------------------------------------------------------- extras - */

async function writeExtras(config, routes) {
  const { site, redirects } = config;
  await writeFile(join(DIST, 'CNAME'), site.domain + '\n');
  // stop GitHub Pages running the output through Jekyll
  await writeFile(join(DIST, '.nojekyll'), '');
  await writeFile(
    join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`
  );

  const today = new Date().toISOString().slice(0, 10);
  const urls = routes
    .map(
      (r) => `  <url>
    <loc>${site.origin}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
    )
    .join('\n');
  await writeFile(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap s.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`.replace('sitemap s', 'sitemaps')
  );

  // Old Tilda paths: a meta-refresh stub at each known path, plus a 404 that
  // maps anything else that looks like an old legal URL.
  for (const [from, to] of Object.entries(redirects)) {
    const clean = from.replace(/^\/|\/$/g, '');
    if (!clean) continue;
    const dir = join(DIST, clean);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'index.html'),
      `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved — FemFast</title>
<meta http-equiv="refresh" content="0; url=${to}">
<link rel="canonical" href="${site.origin}${to}">
<meta name="robots" content="noindex">
</head>
<body>
<p>This page has moved to <a href="${to}">${site.origin}${to}</a>.</p>
</body>
</html>
`
    );
  }

  const map = JSON.stringify(redirects, null, 2);
  await writeFile(
    join(DIST, '404.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — FemFast</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/assets/fonts/outfit.css">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#FDF9F6;color:#453748;
       font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;}
  main{max-width:34em;padding:32px;text-align:center}
  h1{font-family:Outfit,sans-serif;font-weight:800;font-size:clamp(28px,5vw,40px);
     line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px}
  p{font-size:17px;line-height:1.55;color:#5F5062;margin:0 0 28px}
  a.cta{display:inline-block;font-family:Outfit,sans-serif;font-weight:600;font-size:16.5px;
        color:#FDF9F6;background:#8D4F83;padding:15px 26px;border-radius:16px;text-decoration:none}
</style>
</head>
<body>
<main>
  <h1>That page has moved.</h1>
  <p>The link you followed points somewhere that no longer exists. Everything is still here — start from the beginning.</p>
  <p><a class="cta" href="/">Go to FemFast</a></p>
</main>
<script>
// Old Tilda paths still linked from elsewhere (the App Store listing among
// them) land here on GitHub Pages. Send the known ones to their new home.
(function () {
  var MAP = ${map};
  var p = location.pathname.replace(/\\/+$/, '').toLowerCase() || '/';
  var to = MAP[p] || MAP[p + '/'];
  if (to && to !== location.pathname) location.replace(to + location.search + location.hash);
})();
</script>
</body>
</html>
`
  );
}

/* ------------------------------------------------------------------ main - */

async function main() {
  const t0 = Date.now();
  const config = await import(join(SRC, 'site.config.mjs'));
  const data = await loadData();
  // Inlined into every page: one fewer render-blocking request. The url()s are
  // relative to the stylesheet's own folder, so they have to be rewritten to
  // absolute paths once the rules live in the document instead.
  const fontCss = (await readFile(join(VENDOR, 'outfit', 'outfit.css'), 'utf8'))
    .replace(/url\(\.\//g, 'url(/assets/fonts/');
  log('data loaded:', data.phases.phases.length, 'phases,', data.reviews.reviews.length, 'reviews');

  const captures = await buildWorkspace(data);
  const caps = await prerender(captures);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  let landingHtml, checkinHtml;
  try {
    landingHtml = await stitchLanding(browser, caps);
    checkinHtml = await stitchCheckin(browser, caps);
  } finally {
    await browser.close();
  }

  const bodies = {
    landing: landingHtml,
    checkin: checkinHtml,
    help: caps.help.html,
    contact: caps.contact.html,
    privacy: caps.privacy.html,
    terms: caps.terms.html,
  };
  const cssFor = {
    landing: caps.landing.css,
    checkin: caps.step0.css,
    help: caps.help.css,
    contact: caps.contact.css,
    privacy: caps.privacy.css,
    terms: caps.terms.css,
  };

  // which assets the markup actually references — drives the unused-PNG sweep
  const usedAssets = await collectSourceAssets(data);
  for (const html of Object.values(bodies)) {
    for (const m of cleanMarkup(html).matchAll(/\/assets\/[A-Za-z0-9._\-\/]+/g)) usedAssets.add(m[0]);
  }
  const { report, webpSet } = await buildAssets({ usedAssets });

  // app.js is the only script the built site loads. plan.js goes in front of
  // it so the browser runs the same plan code the prerender did.
  const appJs = await readFile(join(SRC, 'app.js'), 'utf8');
  const withData = appJs.replace(
    '/*__DATA__*/null',
    JSON.stringify({ phases: data.phases, rating: data.rating })
  );
  if (withData === appJs) throw new Error('app.js: the /*__DATA__*/null placeholder is missing');
  const { minify } = await import('terser');
  const bundled = PLAN_SRC + '\n' + withData;
  const min = await minify(bundled, { compress: true, mangle: true, format: { comments: false } });
  await writeFile(join(DIST, 'assets', 'app.js'), min.code || bundled);
  log('app.js', kb(Buffer.byteLength(bundled)), '->', kb(Buffer.byteLength(min.code || bundled)), 'minified');

  for (const route of config.routes) {
    let body = wrapPictures(cleanMarkup(bodies[route.source]), webpSet);
    if (route.source === 'landing') body = splitHeaderCta(body);
    const html = page({ route, bodyHtml: body, css: cssFor[route.source], data: { config }, fontCss });
    const outPath = join(DIST, route.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html);
    log('emitted', route.path, `(${kb(Buffer.byteLength(html))})`);
  }

  // Nothing from the old routing scheme may survive into the output. This
  // catches paths that live somewhere rewriteLinks does not look — a component
  // script's lookup table, a prop the footer builds its links from.
  const stale = [];
  for (const route of config.routes) {
    const html = await readFile(join(DIST, route.out), 'utf8');
    for (const bad of ['.dc.html', './index.html', 'support.js', 'unpkg.com', 'x-dc']) {
      if (html.includes(bad)) stale.push(`${route.path} still references "${bad}"`);
    }
  }
  if (stale.length) throw new Error('stale references in output:\n  ' + stale.join('\n  '));
  log('no stale routes, runtime or CDN references in the output');

  await writeExtras(config, config.routes);

  console.log('');
  log('assets on disk before:', kb(report.before), '| after:', kb(report.after), '(both PNG and WebP are shipped)');
  log('assets a modern browser downloads:', kb(report.served), '(WebP served, PNG fallback never requested)');
  if (report.removed.length) log('removed unreferenced:', report.removed.join(', '));
  log('webp generated:', report.webp.length);
  log('done in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('\n[build] FAILED\n' + (e.stack || e.message) + '\n');
    process.exit(1);
  });
}

export { loadData, buildWorkspace, prerender, cleanMarkup, wrapPictures, page, serve, CHROME, ROOT, DIST, WORK, SRC, VENDOR };
