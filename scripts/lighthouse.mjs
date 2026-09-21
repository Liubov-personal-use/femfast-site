#!/usr/bin/env node
/**
 * Lighthouse for every route, mobile and desktop.
 *
 * By default it serves /dist locally and audits that. Pass a base URL to
 * audit a deployed site instead:
 *
 *   npm run lighthouse -- https://user.github.io/femfast-site
 *
 * Local numbers are representative of the markup, CSS and JS but not of real
 * network conditions — a deployed run over the real host is the one to trust
 * for the network-bound metrics.
 */

import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '.build', 'lighthouse');
const PORT = 8961;
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ROUTES = ['/', '/checkin/', '/help/', '/contact/', '/privacy/', '/terms/'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain' };

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let p = join(DIST, url);
      if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
      let body = await readFile(p);
      const type = TYPES[extname(p)] || 'application/octet-stream';
      const headers = { 'content-type': type, 'cache-control': 'public, max-age=31536000' };
      // GitHub Pages compresses text responses, so compress here too —
      // otherwise the local run is penalised for something production does.
      if (/text|javascript|json|xml|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        body = gzipSync(body);
        headers['content-encoding'] = 'gzip';
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(await readFile(join(DIST, '404.html')).catch(() => 'not found'));
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

const MOBILE = {
  formFactor: 'mobile',
  screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false },
  throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4,
    requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675 },
};
const DESKTOP = {
  formFactor: 'desktop',
  screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
  throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
};

async function run(url, chrome, profile, attempt = 1) {
  const res = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: CATEGORIES,
  }, { extends: 'lighthouse:default', settings: profile });
  const lhr = res?.lhr;
  // an occasional run comes back with no categories scored; retry once
  const scored = lhr && CATEGORIES.every((c) => lhr.categories[c]?.score != null);
  if (!scored && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500));
    return run(url, chrome, profile, attempt + 1);
  }
  return lhr;
}

function score(lhr, cat) {
  const s = lhr.categories[cat]?.score;
  return s == null ? null : Math.round(s * 100);
}

async function main() {
  const base = process.argv[2];
  const server = base ? null : await serve();
  const origin = base ? base.replace(/\/$/, '') : `http://localhost:${PORT}`;
  await mkdir(OUT, { recursive: true });

  const chrome = await launch({
    chromePath: CHROME,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const rows = [];
  const problems = [];
  try {
    for (const route of ROUTES) {
      for (const [label, profile] of [['mobile', MOBILE], ['desktop', DESKTOP]]) {
        const url = origin + route;
        const lhr = await run(url, chrome, profile);
        const row = {
          route, device: label,
          performance: score(lhr, 'performance'),
          accessibility: score(lhr, 'accessibility'),
          bestPractices: score(lhr, 'best-practices'),
          seo: score(lhr, 'seo'),
        };
        rows.push(row);
        await writeFile(
          join(OUT, `${route.replace(/\//g, '_') || 'home'}-${label}.json`),
          JSON.stringify(lhr, null, 1)
        );

        // anything under 90 gets its causes listed
        for (const cat of CATEGORIES) {
          const s = score(lhr, cat);
          if (s != null && s < 90) {
            const failed = lhr.categories[cat].auditRefs
              .map((r) => lhr.audits[r.id])
              .filter((a) => a && a.score != null && a.score < 0.9)
              .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
              .slice(0, 6)
              .map((a) => `${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}`);
            problems.push(`${route} ${label} ${cat} = ${s}\n      - ${failed.join('\n      - ')}`);
          }
        }
      }
    }
  } finally {
    await chrome.kill();
    if (server) server.close();
  }

  console.log(`\n  Lighthouse — ${origin}\n`);
  console.log('  route        device    perf   a11y   best   seo');
  console.log('  ------------ --------- ------ ------ ------ ------');
  for (const r of rows) {
    const c = (n) => String(n ?? '-').padEnd(6);
    console.log(`  ${r.route.padEnd(12)} ${r.device.padEnd(9)} ${c(r.performance)} ${c(r.accessibility)} ${c(r.bestPractices)} ${c(r.seo)}`);
  }

  const all = rows.flatMap((r) => [r.performance, r.accessibility, r.bestPractices, r.seo]).filter((n) => n != null);
  console.log(`\n  lowest score across everything: ${Math.min(...all)}`);
  if (problems.length) {
    console.log('\n  below 90:\n');
    problems.forEach((p) => console.log('    ' + p + '\n'));
  } else {
    console.log('  nothing below 90');
  }
  console.log(`  reports in ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
