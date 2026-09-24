#!/usr/bin/env node
/**
 * Functional gate for the built site.
 *
 * The screenshot diff in verify.mjs only proves the first paint matches. This
 * drives the built site the way a person would — answering the check-in,
 * dragging the wheel, tabbing through the FAQ — and asserts the behaviour the
 * migration had to preserve:
 *
 *   - every route returns 200 and every link on it resolves
 *   - no console errors anywhere
 *   - nothing is clipped or overflows horizontally at 390px
 *   - the follicular plan reads the same in all four places it appears
 *   - the check-in keeps its step counter, override chips and row tags, and
 *     never produces a fasting window under 12:12
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = 8951;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ROUTES = ['/', '/checkin/', '/help/', '/contact/', '/privacypolicy', '/termsofuse'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain' };

const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail = '') => results.push({ ok: false, name, detail });

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      // Resolve the way GitHub Pages does, so /privacypolicy answers 200 from
      // privacypolicy.html rather than 301-ing to the trailing-slash form:
      // exact file, then <path>.html, then <path>/index.html.
      let p = join(DIST, url);
      const st = await stat(p).catch(() => null);
      if (!st) {
        p = join(DIST, url + '.html');
      } else if (st.isDirectory()) {
        p = join(p, 'index.html');
      }
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(await readFile(join(DIST, '404.html')).catch(() => 'not found'));
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

async function newPage(browser, width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.errors = errors;
  return page;
}

/* ------------------------------------------------ routes, links, console - */

async function checkRoutesAndLinks(browser) {
  const seen = new Set();
  const broken = [];
  const allErrors = [];

  for (const route of ROUTES) {
    const page = await newPage(browser);
    const res = await page.goto(BASE + route, { waitUntil: 'networkidle' });
    if (res.status() !== 200) fail(`${route} returns 200`, `got ${res.status()}`);
    else pass(`${route} returns 200`);

    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    );
    for (const href of hrefs) {
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || /^https?:/.test(href)) continue;
      const key = href;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = await page.request.get(BASE + href).catch(() => null);
      if (!r || r.status() >= 400) broken.push(`${route} -> ${href} (${r ? r.status() : 'error'})`);
    }

    await page.waitForTimeout(700);
    page.errors.forEach((e) => allErrors.push(`${route}: ${e}`));
    await page.close();
  }

  if (broken.length) fail('every internal link resolves', broken.join('; '));
  else pass('every internal link resolves', `${seen.size} unique links checked`);

  if (allErrors.length) fail('no console errors', allErrors.join('; '));
  else pass('no console errors on any route');
}

/* ------------------------------------------------------- 390px integrity - */

async function checkNarrow(browser) {
  const problems = [];
  for (const route of ROUTES) {
    const page = await newPage(browser, 390, 844);
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const bad = await page.evaluate(() => {
      const out = [];
      const docW = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > docW + 1) {
        out.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${docW})`);
      }
      // any element whose text is cut off by its own box
      for (const el of document.querySelectorAll('h1,h2,h3,h4,p,span,a,button,li,div')) {
        if (!el.childNodes.length) continue;
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent && cs.position !== 'fixed') continue;
        if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
        if (cs.textOverflow === 'ellipsis') continue;
        // a real clip: content wider/taller than the box that hides it
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          out.push(`${el.tagName}.${el.className || ''} clips horizontally ` +
                   `(${el.scrollWidth} > ${el.clientWidth}): "${el.textContent.trim().slice(0, 40)}"`);
        }
      }
      // anything sticking out past the viewport
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > docW + 1.5 && cs.position !== 'fixed') {
          out.push(`${el.tagName} overflows right edge to ${Math.round(r.right)}px`);
        }
      }
      return [...new Set(out)];
    });

    if (bad.length) problems.push(`${route}: ${bad.slice(0, 4).join(' | ')}`);
    await page.close();
  }
  if (problems.length) fail('no clipping or overflow at 390px', problems.join('  ///  '));
  else pass('no clipping or overflow at 390px', 'all six routes');
}

/* ----------------------------------- follicular values in all four places - */

async function checkPhaseData(browser) {
  const phases = JSON.parse(await readFile(join(ROOT, 'data', 'phases.json'), 'utf8'));
  const f = phases.phases.find((p) => p.id === 'follicular');
  const want = { fast: f.fast, food: f.food, train: f.train, supp: f.supp };

  const page = await newPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // 1 + 2. the wheel's day readout and the timeline tiles (default day 6)
  const timeline = await page.evaluate(() => ({
    day: document.querySelector('[data-ff="day"]')?.textContent.trim(),
    phase: document.querySelector('[data-ff="phasePill"]')?.textContent.trim(),
    fast: document.querySelector('[data-ff="fast"]')?.textContent.trim(),
    food: document.querySelector('[data-ff="food"]')?.textContent.trim(),
    train: document.querySelector('[data-ff="train"]')?.textContent.trim(),
    supp: document.querySelector('[data-ff="supp"]')?.textContent.trim(),
    icon: document.querySelector('#phases image')?.getAttribute('href'),
  }));
  const tlOk = timeline.phase === 'Follicular' && timeline.fast === want.fast &&
               timeline.food === want.food && timeline.train === want.train && timeline.supp === want.supp;
  if (tlOk) pass('timeline section shows follicular from phases.json', `${timeline.day}, ${timeline.fast}`);
  else fail('timeline section shows follicular', JSON.stringify(timeline));

  if (timeline.icon && timeline.icon.includes('follicular')) pass('wheel marker uses the follicular icon', timeline.icon);
  else fail('wheel marker uses the follicular icon', String(timeline.icon));

  // 3. the hero phone mockup overlays
  const hero = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll('[data-hero-device] div[aria-hidden="true"]')]
      .map((d) => d.textContent.trim()).filter(Boolean);
    return overlays;
  });
  if (hero.includes(want.supp)) pass('hero phone mockup shows follicular supplements', want.supp);
  else fail('hero phone mockup shows follicular supplements', JSON.stringify(hero));
  if (hero.includes(String(phases.heroMockup.day))) pass('hero phone mockup shows the configured day', String(phases.heroMockup.day));
  else fail('hero phone mockup shows the configured day', JSON.stringify(hero));

  await page.close();
  return want;
}

/* ------------------------------------------------- drive the whole quiz -- */

async function checkCheckin(browser, want) {
  const page = await newPage(browser);
  await page.goto(BASE + '/checkin/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const counter = () => page.textContent('[data-ff="stepCount"]');

  // step counter reads "Step 1 of 6"
  const c1 = (await counter()).trim();
  if (c1 === 'Step 1 of 6') pass('step counter reads "Step 1 of 6"');
  else fail('step counter reads "Step 1 of 6"', c1);

  // Continue starts disabled, Skip is a text link (not a filled button)
  const initial = await page.evaluate(() => {
    const b = document.querySelector('[data-ff="questionBlock"][data-step="0"] [data-ff="continue"]');
    return { disabled: b?.disabled, bg: b ? getComputedStyle(b).backgroundColor : null };
  });
  if (initial.disabled) pass('Continue is disabled until an answer is picked');
  else fail('Continue is disabled until an answer is picked', JSON.stringify(initial));

  // Answer all six. Chosen values drive the overrides we assert on later.
  // goal=energy shortens the fast; fasting=never shortens it again;
  // training=0 replaces training; diet picks add chips and the low-carb note.
  const answers = ['energy', 'regular', '17', 'never', '0', 'veg'];
  for (let step = 0; step < 6; step++) {
    const sel = `[data-ff="questionBlock"][data-step="${step}"]`;
    const want = answers[step];
    const clicked = await page.evaluate(({ sel, want }) => {
      const block = document.querySelector(sel);
      if (!block) return 'no block';
      const opts = [...block.querySelectorAll('[data-ff="opt"]')];
      const hit = opts.find((o) => o.getAttribute('data-v') === want) || opts[0];
      hit.click();
      return hit.getAttribute('data-v');
    }, { sel, want });

    const label = `Step ${step + 1} of 6`;
    const now = (await counter()).trim();
    if (now !== label) fail(`counter reads "${label}"`, now);

    // Skip is a plain underlined text link where it exists, never a filled button
    const skipShape = await page.evaluate((sel) => {
      const s = document.querySelector(`${sel} [data-ff="skip"]`);
      if (!s) return null;
      const cs = getComputedStyle(s);
      return { bg: cs.backgroundColor, border: cs.borderStyle, decoration: cs.textDecorationLine };
    }, sel);
    if (skipShape && !/rgba\(0, 0, 0, 0\)|transparent/.test(skipShape.bg)) {
      fail('Skip is a text link, not a button', JSON.stringify(skipShape));
    }

    await page.click(`${sel} [data-ff="continue"]`);
    await page.waitForTimeout(150);
  }
  pass('all six steps advance with "Step N of 6"');

  // the loading screen carries no counter
  await page.waitForTimeout(250);
  const buildingVisible = await page.isVisible('[data-ff="buildingBlock"]');
  const buildingCounter = (await counter()).trim();
  if (buildingVisible && buildingCounter === '') pass('loading screen shows no step counter');
  else if (!buildingVisible) fail('loading screen appears', 'building block was not visible');
  else fail('loading screen shows no step counter', `counter was "${buildingCounter}"`);

  // result
  await page.waitForSelector('[data-ff="resultBlock"]', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const rows = {};
    document.querySelectorAll('[data-ff="resultBlock"] [data-ff="row"]').forEach((r) => {
      rows[r.getAttribute('data-row')] = {
        value: r.querySelector('[data-ff="rowValue"]')?.textContent.trim(),
        tag: r.querySelector('[data-ff="rowTag"]')?.textContent.trim(),
        tagShown: r.querySelector('[data-ff="rowTag"]')
          ? getComputedStyle(r.querySelector('[data-ff="rowTag"]')).display !== 'none' : false,
      };
    });
    const wrap = document.querySelector('[data-ff="adjustWrap"]');
    return {
      headline: document.querySelector('[data-ff="resultHeadline"]')?.textContent.trim(),
      phase: document.querySelector('[data-ff="resultPhase"]')?.textContent.trim(),
      badge: document.querySelector('[data-ff="resultBadge"]')?.getAttribute('src'),
      chips: wrap && getComputedStyle(wrap).display !== 'none'
        ? [...wrap.querySelectorAll('[data-ff="chip"]')]
            .filter((c) => getComputedStyle(c).display !== 'none')
            .map((c) => c.textContent.trim())
        : [],
      rows,
    };
  });

  // day 17 is luteal, so the result must name that phase and badge
  if (/Luteal/i.test(result.phase || '')) pass('result names the phase for the chosen day', result.phase);
  else fail('result names the phase for the chosen day', String(result.phase));
  if ((result.badge || '').includes('luteal')) pass('result badge matches the phase', result.badge);
  else fail('result badge matches the phase', String(result.badge));

  // the 12:12 floor, on the screen rather than in the unit test
  const fastVal = result.rows.Fasting?.value || '';
  const hours = parseInt(fastVal, 10);
  if (hours >= 12) pass('fasting window respects the 12:12 floor', fastVal);
  else fail('fasting window respects the 12:12 floor', fastVal);

  // "Adjusted for" chips and row tags survived the port
  if (result.chips.length) pass('"Adjusted for" chips render', result.chips.join(', '));
  else fail('"Adjusted for" chips render', 'none shown');

  const tagged = Object.entries(result.rows).filter(([, v]) => v.tagShown && v.tag);
  if (tagged.length) pass('row "Adjusted for ..." tags render', tagged.map(([k, v]) => `${k}: ${v.tag}`).join(' | '));
  else fail('row "Adjusted for ..." tags render', JSON.stringify(result.rows));

  // training override applied
  const overrides = JSON.parse(await readFile(join(ROOT, 'data', 'phases.json'), 'utf8')).planOverrides;
  if (result.rows.Training?.value === overrides.trainingForNoRoutine) {
    pass('"no routine" override replaces the training row', result.rows.Training.value);
  } else {
    fail('"no routine" override replaces the training row', String(result.rows.Training?.value));
  }

  // 4. the result reads plan values from phases.json
  await page.evaluate(() => document.querySelector('[data-ff="restart"]').click());
  await page.waitForTimeout(300);
  // day 6 is follicular, and no override is chosen, so the rows should be the
  // untouched phase defaults. The last question is optional — skip it.
  for (const [step, v] of [[0, 'weight'], [1, 'regular'], [2, '6'], [3, 'regular'], [4, '3'], [5, null]]) {
    const sel = `[data-ff="questionBlock"][data-step="${step}"]`;
    if (v) await page.evaluate(({ sel, v }) => {
      document.querySelector(`${sel} [data-ff="opt"][data-v="${v}"]`)?.click();
    }, { sel, v });
    await page.waitForTimeout(120);
    // advance with Continue when it is enabled, otherwise with the Skip link
    await page.evaluate((sel) => {
      const cont = document.querySelector(`${sel} [data-ff="continue"]`);
      const skip = document.querySelector(`${sel} [data-ff="skip"]`);
      if (cont && !cont.disabled) cont.click();
      else if (skip) skip.click();
      else if (cont) cont.click();
    }, sel);
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('[data-ff="resultBlock"]', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(2600);
  const follicular = await page.evaluate(() => {
    const rows = {};
    document.querySelectorAll('[data-ff="resultBlock"] [data-ff="row"]').forEach((r) => {
      rows[r.getAttribute('data-row')] = r.querySelector('[data-ff="rowValue"]')?.textContent.trim();
    });
    return rows;
  });
  if (follicular.Fasting === want.fast && follicular.Training === want.train && follicular.Supplements === want.supp) {
    pass('check-in result reads follicular plan from phases.json',
      `${follicular.Fasting} / ${follicular.Training} / ${follicular.Supplements}`);
  } else {
    fail('check-in result reads follicular plan from phases.json', JSON.stringify(follicular));
  }

  if (page.errors.length) fail('no console errors while using the check-in', page.errors.join('; '));
  else pass('no console errors while using the check-in');

  await page.close();
}

/* ------------------------------------------------- the legal URLs matter - */

/**
 * https://femfast.io/privacypolicy and /termsofuse are the addresses in the
 * App Store listing, and those fields are not changing. They have to be the
 * pages themselves — 200 with the policy on them — not redirects to a
 * prettier path. Both the bare and trailing-slash forms have to work, and the
 * text has to match the source verbatim.
 */
async function checkLegalRoutes(browser) {
  const cases = [
    { name: 'privacy', src: 'src/privacy.page.html', heading: 'Privacy Policy',
      paths: ['/privacypolicy', '/privacypolicy/'], canonical: 'https://femfast.io/privacypolicy',
      froms: ['/privacy/', '/privacy-policy', '/privacy-policy/', '/privacy-policy.html'] },
    { name: 'terms', src: 'src/terms.page.html', heading: 'Terms of Use',
      paths: ['/termsofuse', '/termsofuse/'], canonical: 'https://femfast.io/termsofuse',
      froms: ['/terms/'] },
  ];

  for (const c of cases) {
    // the verbatim source: the TEXT template literal the page renders from
    const srcText = await readFile(join(ROOT, c.src), 'utf8');
    const start = srcText.indexOf('const TEXT = `') + 'const TEXT = `'.length;
    const body = srcText.slice(start, srcText.indexOf('`;', start));
    const paragraphs = body.split('\n').map((x) => x.trim()).filter(Boolean);

    for (const path of c.paths) {
      const page = await newPage(browser);
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
      const status = res.status();
      if (status !== 200) { fail(`${path} returns 200`, `got ${status}`); await page.close(); continue; }
      pass(`${path} returns 200`);

      const info = await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent.trim(),
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        text: document.body.innerText.replace(/\s+/g, ' '),
      }));

      if (info.h1 === c.heading) pass(`${path} shows "${c.heading}"`);
      else fail(`${path} shows "${c.heading}"`, `h1 was "${info.h1}"`);

      if (info.canonical === c.canonical) pass(`${path} canonical is ${c.canonical}`);
      else fail(`${path} canonical`, `got ${info.canonical}`);

      // verbatim: every source paragraph present, in order
      const norm = (x) => x.replace(/\s+/g, ' ').trim();
      let cursor = 0, missing = null;
      for (const para of paragraphs) {
        const at = info.text.indexOf(norm(para), cursor);
        if (at < 0) { missing = para; break; }
        cursor = at + norm(para).length;
      }
      if (missing) fail(`${path} text is verbatim`, `missing/out of order: "${missing.slice(0, 60)}…"`);
      else pass(`${path} text is verbatim`, `${paragraphs.length} paragraphs, in order`);

      await page.close();
    }

    // The old path must land on the new one. Read the served bytes rather than
    // the DOM: a 0s meta refresh navigates away before the page can be
    // inspected, which is the point of it.
    const target = c.paths[0];
    for (const from of c.froms) {
      const page = await newPage(browser);
      const res = await page.request.get(BASE + from);
      const raw = await res.text();
      const grab = (re) => (raw.match(re) || [])[1];
      const stub = {
        status: res.status(),
        refresh: grab(/http-equiv="refresh"\s+content="([^"]*)"/),
        canonical: grab(/rel="canonical"\s+href="([^"]*)"/),
        link: grab(/<a href="([^"]*)"/),
        noindex: /name="robots" content="noindex"/.test(raw),
      };
      if (stub.status === 200 && stub.refresh === `0; url=${target}` && stub.link === target &&
          stub.canonical === c.canonical && stub.noindex) {
        pass(`${from} stub points at ${target}`, '200, meta refresh 0s + canonical + fallback link + noindex');
      } else {
        fail(`${from} stub points at ${target}`, JSON.stringify(stub));
      }

      // and actually follow it, to prove where a browser ends up
      await page.goto(BASE + from, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForURL(BASE + target, { timeout: 8000 });
        const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim());
        if (h1 === c.heading) pass(`${from} lands on ${target}`, `"${h1}"`);
        else fail(`${from} lands on ${target}`, `h1 was "${h1}"`);
      } catch {
        fail(`${from} lands on ${target}`, `ended at ${page.url()}`);
      }
      await page.close();
    }
  }

  // nothing anywhere should still point at the old paths
  const page = await newPage(browser);
  const stale = [];
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    for (const h of hrefs) {
      if (h === '/privacy/' || h === '/terms/' || h === '/privacy' || h === '/terms') {
        stale.push(`${route} -> ${h}`);
      }
    }
  }
  await page.close();
  if (stale.length) fail('no internal link points at the old legal paths', stale.join('; '));
  else pass('no internal link points at the old legal paths');
}

/* --------------------------------------------------------- wheel + FAQ --- */

async function checkWheelAndFaq(browser) {
  const page = await newPage(browser);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // clicking a phase pill moves the wheel and the tiles together
  for (const id of ['luteal', 'menstrual', 'ovulatory']) {
    await page.click(`[data-ff="legend"][data-phase="${id}"]`);
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({
      pill: document.querySelector('[data-ff="phasePill"]')?.textContent.trim(),
      fast: document.querySelector('[data-ff="fast"]')?.textContent.trim(),
      icon: document.querySelector('#phases image')?.getAttribute('href'),
      pressed: document.querySelector('[aria-pressed="true"][data-ff="legend"]')?.getAttribute('data-phase'),
    }));
    const phases = JSON.parse(await readFile(join(ROOT, 'data', 'phases.json'), 'utf8')).phases;
    const p = phases.find((x) => x.id === id);
    if (state.pill === p.name && state.fast === p.fast && state.icon.includes(id) && state.pressed === id) {
      pass(`wheel pill "${p.name}" updates dial, tiles and pressed state`, state.fast);
    } else {
      fail(`wheel pill "${p.name}" updates everything`, JSON.stringify(state));
    }
  }

  // dragging the dial scrubs the day
  const before = await page.textContent('[data-ff="day"]');
  const box = await page.locator('[data-ff="wheelDrag"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.textContent('[data-ff="day"]');
  if (before !== after) pass('dragging the dial changes the day', `${before.trim()} -> ${after.trim()}`);
  else fail('dragging the dial changes the day', `stayed at ${before}`);

  // FAQ opens and closes
  const faqState = async () => page.evaluate(() => {
    const b = document.querySelectorAll('[data-ff="faqBtn"]');
    return [...b].map((x) => x.getAttribute('aria-expanded'));
  });
  const s0 = await faqState();
  await page.click('[data-ff="faqBtn"][data-i="2"]');
  await page.waitForTimeout(400);
  const s1 = await faqState();
  const opened = s1[2] === 'true' && s1[0] === 'false';
  const panelH = await page.evaluate(() =>
    document.querySelector('[data-ff="faqBtn"][data-i="2"]').nextElementSibling.getBoundingClientRect().height);
  if (opened && panelH > 20) pass('FAQ opens the clicked item and closes the others', `panel ${Math.round(panelH)}px`);
  else fail('FAQ opens the clicked item', `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}, panel ${panelH}px`);

  if (page.errors.length) fail('no console errors while using the landing page', page.errors.join('; '));
  else pass('no console errors while using the landing page');
  await page.close();
}

/* ------------------------------------------------------------------ run -- */

async function main() {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    await checkRoutesAndLinks(browser);
    const want = await checkPhaseData(browser);
    await checkCheckin(browser, want);
    await checkLegalRoutes(browser);
    await checkWheelAndFaq(browser);
    await checkNarrow(browser);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - bad.length}/${results.length} checks passed\n`);
  if (bad.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
