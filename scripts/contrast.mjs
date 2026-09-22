#!/usr/bin/env node
/**
 * Worst-case WCAG contrast for the site's translucent body ink.
 *
 * The body copy is rgba(69,55,72,α), so what lands on screen depends on what
 * is behind it — and behind the hero text is a WebGL shader painting a
 * gradient, not a flat colour. So nothing here assumes a background.
 *
 * For each element using that ink it takes two screenshots of the element's
 * box: one as rendered, one with every glyph on the page hidden. The pixels
 * that differ are exactly where the text is drawn; the second shot gives the
 * backdrop at those same pixels. The ink is composited over the darkest such
 * backdrop and the contrast reported against it.
 *
 * Measuring only glyph pixels matters: an element's box routinely overlaps
 * something darker that the letters never touch — the hero caption's box
 * catches the phone's drop shadow, and a paragraph's box can contain a child
 * span in another colour. Sampling the whole box would report those as the
 * backdrop and fail text that is perfectly legible.
 *
 *   node scripts/contrast.mjs
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = 8991;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ROUTES = ['/', '/checkin/', '/help/', '/contact/', '/privacy/', '/terms/'];
const WIDTHS = [{ label: '1440', w: 1440, h: 900 }, { label: '390', w: 390, h: 844 }];

// The ink this audit is about: the body copy on cream. Light-on-dark
// translucent text (the science section, the numbered steps) is a separate
// palette and out of scope here.
const INK = [69, 55, 72];
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json' };

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let p = join(DIST, url);
      if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const composite = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
const hex = ([r, g, b]) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');

const HIDE_TEXT = '*,*::before,*::after{color:transparent!important;text-shadow:none!important}';

async function raw(buf) {
  return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function main() {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const results = [];

  try {
    for (const route of ROUTES) {
      for (const vp of WIDTHS) {
        const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
        await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(900);

        const targets = await page.evaluate((ink) => {
          const out = [];
          document.querySelectorAll('*').forEach((el, i) => {
            const cs = getComputedStyle(el);
            const m = cs.color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
            if (!m) return;
            const [r, g, b, a] = [+m[1], +m[2], +m[3], parseFloat(m[4])];
            if (r !== ink[0] || g !== ink[1] || b !== ink[2]) return;  // different palette
            if (a >= 1 || a === 0) return;            // opaque, or deliberately invisible
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!hasText) return;
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) return;
            el.setAttribute('data-contrast-probe', String(i));
            out.push({
              id: String(i), alpha: a,
              fontSize: parseFloat(cs.fontSize),
              bold: (parseInt(cs.fontWeight, 10) || 400) >= 700,
              text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 38),
            });
          });
          return out;
        }, INK);

        for (const t of targets) {
          const loc = page.locator(`[data-contrast-probe="${t.id}"]`);
          let shotText, shotBare;
          try {
            shotText = await loc.screenshot({ timeout: 8000 });
            const style = await page.addStyleTag({ content: HIDE_TEXT });
            shotBare = await loc.screenshot({ timeout: 8000 });
            await page.evaluate((el) => el.remove(), style);
          } catch { continue; }

          const A = await raw(shotText);
          const B = await raw(shotBare);
          if (A.info.width !== B.info.width || A.info.height !== B.info.height) continue;

          // glyph pixels = where hiding the text changed what was painted
          let darkest = null, dl = Infinity, inkedAt = null, glyphPx = 0;
          const n = A.info.width * A.info.height;
          for (let i = 0; i < n; i++) {
            const o = i * A.info.channels;
            const ta = [A.data[o], A.data[o + 1], A.data[o + 2]];
            const bg = [B.data[o], B.data[o + 1], B.data[o + 2]];
            const delta = Math.abs(ta[0] - bg[0]) + Math.abs(ta[1] - bg[1]) + Math.abs(ta[2] - bg[2]);
            if (delta < 30) continue;              // not a glyph pixel (or faint AA edge)
            glyphPx++;
            const l = luminance(bg);
            if (l < dl) { dl = l; darkest = bg; inkedAt = ta; }
          }
          if (!darkest || glyphPx < 20) continue;

          // Use the ink composited by the browser where available; fall back to
          // computing it, which matters on anti-aliased edges.
          const inked = composite(INK, t.alpha, darkest);
          const ratio = contrast(inked, darkest);
          const large = t.fontSize >= 24 || (t.bold && t.fontSize >= 18.66);
          results.push({
            route, width: vp.label, ratio,
            need: large ? AA_LARGE : AA_NORMAL,
            backdrop: hex(darkest), inked: hex(inked),
            glyphPx, text: t.text,
          });
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  results.sort((a, b) => a.ratio - b.ratio);
  const failing = results.filter((r) => r.ratio < r.need);

  console.log(`\n  rgba(${INK.join(',')},α) body copy — ${results.length} elements, ` +
    `measured only where glyphs actually land\n`);
  console.log('  ratio  need  backdrop  ink       route      w     content');
  console.log('  ------ ----- --------- --------- ---------- ----- ------------------------------');
  for (const r of results.slice(0, 10)) {
    console.log(
      `  ${r.ratio.toFixed(2).padStart(5)}${r.ratio < r.need ? '!' : ' '} ` +
      `${String(r.need).padStart(4)}  ${r.backdrop.padEnd(9)} ${r.inked.padEnd(9)} ` +
      `${r.route.padEnd(10)} ${r.width.padEnd(5)} ${r.text}`
    );
  }
  if (results.length > 10) console.log(`  … ${results.length - 10} more, all higher`);

  const worst = results[0];
  const darkestBackdrop = results.reduce(
    (a, r) => (luminance(hexToRgb(r.backdrop)) < luminance(hexToRgb(a)) ? r.backdrop : a),
    results[0].backdrop
  );
  console.log(`\n  darkest backdrop this ink ever sits on: ${darkestBackdrop}`);
  console.log(`  worst case: ${worst.ratio.toFixed(2)}:1 needing ${worst.need}:1 — "${worst.text}"`);

  if (failing.length) {
    console.log(`\n  ${failing.length} element(s) BELOW AA\n`);
    process.exit(1);
  }
  console.log(`\n  all ${results.length} meet WCAG AA\n`);
}

function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }

main().catch((e) => { console.error(e); process.exit(1); });
