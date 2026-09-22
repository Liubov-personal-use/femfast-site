#!/usr/bin/env node
/**
 * Publish /dist to the gh-pages branch.
 *
 *   npm run deploy                      # keep whatever domain gh-pages has
 *   npm run deploy -- --domain femfast.io   # set the domain (cutover)
 *   npm run deploy -- --no-domain       # remove the CNAME entirely
 *   npm run deploy -- --dry-run         # show what would happen, push nothing
 *
 * THE POINT OF THIS SCRIPT IS THE CNAME.
 *
 * Setting a custom domain in the GitHub Pages UI works by committing a CNAME
 * file to the served branch. So the domain is not stored in settings somewhere
 * safe — it lives in the branch, and any publish that rebuilds the branch from
 * /dist will delete it and unset the custom domain, taking the site off its
 * domain until someone notices.
 *
 * So this script never copies /dist/CNAME: it reads the CNAME already on the
 * remote branch and writes that one back, unless --domain or --no-domain says
 * otherwise. The branch is the source of truth for the domain, not the build.
 *
 * It also commits on top of the existing branch rather than force-pushing a
 * fresh history, so GitHub's own "Create CNAME" commit stays in the log.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rm, mkdir, mkdtemp, cp, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const REMOTE = process.env.DEPLOY_REMOTE || 'https://github.com/Liubov-personal-use/femfast-site.git';
const BRANCH = 'gh-pages';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i > -1 ? args[i + 1] : null;
};
const DRY = has('--dry-run');
const NO_DOMAIN = has('--no-domain');
const SET_DOMAIN = valueOf('--domain');

const log = (...a) => console.log('[deploy]', ...a);
const git = async (cwd, ...a) => (await execFileAsync('git', a, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function main() {
  if (SET_DOMAIN && NO_DOMAIN) throw new Error('--domain and --no-domain are mutually exclusive');

  // refuse to publish something that is not a built site
  if (!(await exists(join(DIST, 'index.html')))) {
    throw new Error('dist/index.html is missing — run `npm run build` first');
  }

  const work = await mkdtemp(join(tmpdir(), 'ffdeploy-'));
  try {
    log('fetching', BRANCH);
    await git(work, 'init', '-q');
    await git(work, 'remote', 'add', 'origin', REMOTE);

    let fresh = false;
    try {
      await git(work, 'fetch', '--depth', '1', '-q', 'origin', BRANCH);
      await git(work, 'checkout', '-q', '-B', BRANCH, 'FETCH_HEAD');
    } catch {
      log(`no ${BRANCH} on the remote yet — creating it`);
      await git(work, 'checkout', '-q', '-b', BRANCH);
      fresh = true;
    }

    // ---- the domain, before anything is deleted --------------------------
    const cnamePath = join(work, 'CNAME');
    const existing = (await exists(cnamePath))
      ? (await readFile(cnamePath, 'utf8')).trim()
      : null;

    let domain;
    if (SET_DOMAIN) domain = SET_DOMAIN.trim();
    else if (NO_DOMAIN) domain = null;
    else domain = existing;

    if (existing) log(`gh-pages currently serves: ${existing}`);
    else log('gh-pages currently has no CNAME (no custom domain)');

    if (SET_DOMAIN && existing && SET_DOMAIN.trim() !== existing) {
      log(`CHANGING the custom domain: ${existing} -> ${SET_DOMAIN.trim()}`);
    } else if (NO_DOMAIN && existing) {
      log(`REMOVING the custom domain (was ${existing})`);
    } else if (domain) {
      log(`preserving the custom domain: ${domain}`);
    }

    // ---- replace the tree with /dist -------------------------------------
    if (!fresh) {
      for (const entry of await readdir(work)) {
        if (entry === '.git') continue;
        await rm(join(work, entry), { recursive: true, force: true });
      }
    }
    await cp(DIST, work, { recursive: true });

    // /dist ships the production CNAME; the served one wins.
    await rm(cnamePath, { force: true });
    if (domain) {
      // GitHub writes it without a trailing newline; match that so the file
      // does not churn on every deploy.
      await writeFile(cnamePath, domain);
    }

    await git(work, 'add', '-A');
    const status = await git(work, 'status', '--porcelain');
    if (!status) {
      log('nothing changed — not pushing');
      return;
    }
    console.log('\n' + status.split('\n').slice(0, 40).join('\n'));
    if (status.split('\n').length > 40) console.log(`… ${status.split('\n').length - 40} more`);
    console.log('');

    if (DRY) {
      log('--dry-run: stopping before commit and push');
      log(`CNAME would be: ${domain ?? '(none)'}`);
      return;
    }

    await git(work, '-c', 'user.name=femfast-deploy', '-c', 'user.email=noreply@femfast.io',
      'commit', '-q', '-m', `Publish built site${domain ? ` (${domain})` : ''}`);
    await git(work, 'push', '-q', 'origin', BRANCH);

    const head = await git(work, 'rev-parse', '--short', 'HEAD');
    log(`pushed ${head} to ${BRANCH}`);
    log(`CNAME: ${domain ?? '(none)'}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('\n[deploy] FAILED\n' + (e.stack || e.message) + '\n');
  process.exit(1);
});
