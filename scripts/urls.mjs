#!/usr/bin/env node
/**
 * path -> status -> final URL, for every address that has to work.
 *
 *   npm run urls                                 # against the local /dist
 *   npm run urls -- https://femfast.io           # against the live site
 *
 * Navigations run in a real browser, so a meta-refresh stub is followed the
 * way a visitor's browser follows it, not just reported as a 200.
 *
 * The local server resolves the way GitHub Pages does — exact file, then
 * <path>.html, then <path>/index.html — so /privacypolicy answers from
 * privacypolicy.html rather than redirecting to the trailing-slash form.
 * It is an emulation; a run against the deployed site is the real answer.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = 8997;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// what must work, and what it must end up as
const CASES = [
  { path: '/', expect: '/' },
  { path: '/checkin/', expect: '/checkin/' },
  { path: '/help/', expect: '/help/' },
  { path: '/contact/', expect: '/contact/' },
  { path: '/privacypolicy', expect: '/privacypolicy', note: 'App Store link' },
  { path: '/privacypolicy/', expect: '/privacypolicy/' },
  { path: '/termsofuse', expect: '/termsofuse', note: 'App Store link' },
  { path: '/termsofuse/', expect: '/termsofuse/' },
  { path: '/privacy/', expect: '/privacypolicy', note: 'old path' },
  { path: '/terms/', expect: '/termsofuse', note: 'old path' },
  { path: '/privacy-policy', expect: '/privacypolicy', note: 'hyphenated' },
  { path: '/privacy-policy/', expect: '/privacypolicy', note: 'hyphenated' },
  { path: '/privacy-policy.html', expect: '/privacypolicy', note: 'hyphenated' },
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain' };

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let p = join(DIST, url);
      const st = await stat(p).catch(() => null);
      if (!st) p = join(DIST, url + '.html');
      else if (st.isDirectory()) p = join(p, 'index.html');
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

async function main() {
  const base = (process.argv[2] || '').replace(/\/$/, '');
  const server = base ? null : await serve();
  const origin = base || `http://localhost:${PORT}`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  const rows = [];
  try {
    for (const c of CASES) {
      const page = await browser.newPage();
      let status = null, mixed = [];
      page.on('response', (r) => {
        if (r.url() === origin + c.path && status === null) status = r.status();
      });
      page.on('request', (r) => {
        if (r.url().startsWith('http://') && !r.url().startsWith('http://localhost')) mixed.push(r.url());
      });
      let err = null;
      try {
        const res = await page.goto(origin + c.path, { waitUntil: 'networkidle', timeout: 45000 });
        if (status === null) status = res?.status() ?? null;
        // give a meta-refresh stub a moment to do its job
        await page.waitForTimeout(900);
      } catch (e) {
        err = String(e.message || e).split('\n')[0].slice(0, 60);
      }
      const finalUrl = page.url();
      const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim()).catch(() => null);
      const title = await page.title().catch(() => null);
      await page.close();

      // drop the fragment: the check-in writes its step into the hash with
      // history.replaceState, which is behaviour, not routing
      const noHash = finalUrl.split('#')[0];
      const finalPath = noHash.startsWith(origin) ? noHash.slice(origin.length) || '/' : noHash;
      rows.push({ ...c, status, finalPath, h1, title, mixed: mixed.length, err });
    }
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log(`\n  ${origin}\n`);
  console.log('  requested          status  final path         page');
  console.log('  ------------------ ------- ------------------ ------------------------------');
  let bad = 0;
  for (const r of rows) {
    const ok = r.status === 200 && r.finalPath === r.expect && !r.err;
    if (!ok) bad++;
    console.log(
      `  ${r.path.padEnd(18)} ${String(r.err ? 'ERR' : r.status).padEnd(7)} ` +
      `${String(r.finalPath).padEnd(18)} ${(r.h1 || r.title || '').slice(0, 30)}` +
      `${ok ? '' : '   <-- expected ' + r.expect}`
    );
  }

  const mixedTotal = rows.reduce((n, r) => n + r.mixed, 0);
  console.log('');
  console.log(`  mixed content (http:// subresources): ${mixedTotal === 0 ? 'none' : mixedTotal + ' !'}`);
  console.log(`  ${rows.length - bad}/${rows.length} addresses resolve as expected\n`);
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
