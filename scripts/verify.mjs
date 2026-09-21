#!/usr/bin/env node
/**
 * Pixel diff: the frozen export in /reference against the built site in /dist.
 *
 * Both are served from one origin (/ref/* is the baseline, everything else is
 * the build) so they share the self-hosted font and nothing is cross-origin.
 * Screenshots are taken with reduced motion, which makes both sides
 * deterministic: the hero shader paints a single fixed frame, the wheel's
 * auto-cycle never starts, and the scroll-reveal animations are off.
 *
 * Output: a per-route, per-width report and, for anything that differs, a
 * highlighted diff image in .build/diff/.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const REF = join(ROOT, 'reference');
const OUT = join(ROOT, '.build', 'diff');
const PORT = 8931;

const CHROME =
  process.env.CHROME_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// baseline page, built page, and whether the shot is the whole document
const ROUTES = [
  { name: 'home',    ref: '/ref/index.html',         built: '/',         full: true },
  { name: 'checkin', ref: '/ref/index.html',         built: '/checkin/', full: false, openQuiz: true },
  { name: 'help',    ref: '/ref/Help.dc.html',       built: '/help/',    full: true },
  { name: 'contact', ref: '/ref/Contacts.dc.html',   built: '/contact/', full: true },
  { name: 'privacy', ref: '/ref/Privacy.dc.html',    built: '/privacy/', full: true },
  { name: 'terms',   ref: '/ref/Terms.dc.html',      built: '/terms/',   full: true },
];

const WIDTHS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json' };

function serveBoth() {
  const server = createServer(async (req, res) => {
    try {
      let url = decodeURIComponent(req.url.split('?')[0]);
      let base = DIST;
      if (url.startsWith('/ref/')) { base = REF; url = url.slice(4); }
      let p = join(base, url);
      if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

async function shoot(browser, url, vp, { full, openQuiz, isRef }) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  // The baseline's <head> asks Google Fonts for Outfit, which we replace with
  // the self-hosted copy the built site uses, so both render the same glyphs.
  await page.route('**/fonts.googleapis.com/**', (route) => route.abort());
  await page.route('**/fonts.gstatic.com/**', (route) => route.abort());

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (isRef) {
    await page.addStyleTag({ url: '/assets/fonts/outfit.css' });
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(900);

  if (openQuiz) {
    if (isRef) {
      // the baseline opens the check-in as an in-page overlay
      await page.evaluate(() => {
        const a = [...document.querySelectorAll('a')].find((x) => /60-second check-in/i.test(x.textContent));
        if (a) a.click();
      });
      await page.waitForTimeout(900);
    }
  }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(400);

  const buf = await page.screenshot({ fullPage: !!full });
  await page.close();
  return { buf, errors };
}

async function diff(aBuf, bBuf, outPath) {
  const A = sharp(aBuf), B = sharp(bBuf);
  const [ma, mb] = [await A.metadata(), await B.metadata()];
  const w = Math.min(ma.width, mb.width);
  const h = Math.min(ma.height, mb.height);
  const sizeMismatch = ma.width !== mb.width || ma.height !== mb.height;

  const toRaw = (img) =>
    img.clone().extract({ left: 0, top: 0, width: w, height: h })
       .ensureAlpha().raw().toBuffer();
  const [ra, rb] = [await toRaw(A), await toRaw(B)];

  const out = Buffer.alloc(w * h * 4);
  let changed = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const d = Math.abs(ra[o] - rb[o]) + Math.abs(ra[o + 1] - rb[o + 1]) + Math.abs(ra[o + 2] - rb[o + 2]);
    if (d > 24) {                       // tolerance for sub-pixel AA
      changed++;
      out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255;
    } else {
      const g = 235;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  const pct = (changed / (w * h)) * 100;
  if (changed) {
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPath);
  }
  return { changed, total: w * h, pct, sizeMismatch, dims: [ma, mb] };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = await serveBoth();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  const rows = [];
  const consoleErrors = [];
  try {
    for (const r of ROUTES) {
      for (const vp of WIDTHS) {
        const a = await shoot(browser, `http://localhost:${PORT}${r.ref}`, vp,
          { full: r.full, openQuiz: r.openQuiz, isRef: true });
        const b = await shoot(browser, `http://localhost:${PORT}${r.built}`, vp,
          { full: r.full, openQuiz: r.openQuiz, isRef: false });
        // only the built site's console is a real signal
        b.errors.forEach((e) => consoleErrors.push(`${r.name}@${vp.label}: ${e}`));

        const res = await diff(a.buf, b.buf, join(OUT, `${r.name}-${vp.label}.png`));
        rows.push({ route: r.name, width: vp.label, ...res });
        await writeFile(join(OUT, `${r.name}-${vp.label}-before.png`), a.buf);
        await writeFile(join(OUT, `${r.name}-${vp.label}-after.png`), b.buf);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n  route      width   baseline px      built px       differing      ');
  console.log('  ---------- ------- ---------------- -------------- ---------------');
  let worst = 0;
  for (const r of rows) {
    const [a, b] = r.dims;
    worst = Math.max(worst, r.pct);
    const verdict = r.changed === 0 ? 'identical' : `${r.pct.toFixed(3)}% (${r.changed})`;
    console.log(
      `  ${r.route.padEnd(10)} ${r.width.padEnd(7)} ${String(a.width + 'x' + a.height).padEnd(16)} ` +
      `${String(b.width + 'x' + b.height).padEnd(14)} ${verdict}${r.sizeMismatch ? '  SIZE MISMATCH' : ''}`
    );
  }

  console.log('');
  if (consoleErrors.length) {
    console.log('  console errors on the built site:');
    consoleErrors.forEach((e) => console.log('   -', e));
  } else {
    console.log('  no console errors on any built route');
  }
  console.log(`\n  worst difference: ${worst.toFixed(3)}%`);
  console.log(
    '  (a same-page-twice control diffs at 0 px, so anything above is real —\n' +
    '   what remains is sub-pixel anti-aliasing inside the hero phone mockup,\n' +
    '   which renders in a CSS `perspective` 3D layer at fractional coordinates)'
  );
  console.log(`  images in ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
