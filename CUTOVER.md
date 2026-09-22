# Cutover — moving femfast.io from Tilda to GitHub Pages

**No DNS change has been made and no custom domain has been set.** The live
Tilda site is untouched and keeps serving femfast.io until you change DNS
yourself.

Steps 0-2 are done: the repository exists, both branches are pushed, Pages is
live, and staging is serving at https://staging.femfast.io. Everything from
Step 3 on is yours to do.

Read the whole thing once before starting. The DNS change is the only step
that is visible to the public, and it is the last one.

---

## Before you start

| | |
|---|---|
| GitHub account | `Liubov-personal-use` |
| Repository | [`femfast-site`](https://github.com/Liubov-personal-use/femfast-site) — `main` (source) + `gh-pages` (served) |
| Staging URL | <https://staging.femfast.io> — live |
| Production domain | `femfast.io` |
| DNS host | Cloudflare |
| Current origin | Tilda |

You will need: access to the GitHub account, and access to the Cloudflare
dashboard for `femfast.io`.

---

## Step 0 — Repository and branches — **done**

`femfast-site` exists and both branches are pushed:

| Branch | Contents |
|---|---|
| `main` | the source: `/src`, `/data`, `/scripts`, `/dist`, docs |
| `gh-pages` | the contents of `/dist` — this is what Pages serves |

Pages, when deploying from a branch, only serves the **root** of that branch
or a `/docs` folder — it cannot be pointed at `/dist`. Hence the second
branch. `/dist` on `main` stays the canonical build output; `gh-pages` is
only the serving copy.

> The alternative is a GitHub Actions workflow that builds and deploys on
> every push. That was deliberately not added — you asked for no Actions.

### Publishing a change

```bash
npm run build && npm run check && npm run verify
npm run deploy
```

**Use `npm run deploy`. Do not rebuild `gh-pages` by hand.**

Setting a custom domain in the Pages UI works by committing a `CNAME` file to
the served branch — so the domain is not held in settings somewhere safe, it
lives in the branch. Any publish that rebuilds `gh-pages` from `/dist` deletes
it, which unsets the custom domain and takes the site off its domain until
someone notices.

`npm run deploy` reads the `CNAME` already on the remote branch and writes it
back, so the domain survives every push. It also commits on top of the branch
instead of force-pushing a fresh history, so GitHub's own "Create CNAME"
commit stays in the log. `npm run deploy -- --dry-run` shows what would change
and pushes nothing.

Note that `/dist/CNAME` holds `femfast.io`, the **production** domain, which
is deliberately not what staging serves. The script never copies it — the
domain already on the branch wins unless you pass `--domain` explicitly.

---

## Step 1 — GitHub Pages — **done**

Source is **Deploy from a branch**, branch `gh-pages`, folder `/ (root)`, with
the custom domain set to `staging.femfast.io`.

---

## Step 2 — Staging — **live**

<https://staging.femfast.io>

Because the custom domain is set, the site is served from the domain root, so
absolute links, canonical tags and OG tags all resolve the way they will in
production. The only difference from production is the hostname.

Scores against staging:

```bash
npm run lighthouse -- https://staging.femfast.io
```

---

## Step 3 — Cloudflare DNS

Open Cloudflare → select `femfast.io` → **DNS** → **Records**.

### 3a. Write down what is there now

**Before changing anything**, screenshot or copy the existing records for
`femfast.io` and `www`. You need them for the rollback in Step 7. Tilda's A
record is typically `185.197.2.x`, but record what is actually there rather
than trusting that.

### 3b. Replace the apex A record(s)

Delete every existing **A** and **AAAA** record for `femfast.io` (name `@` or
`femfast.io`), then add these four A records:

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| A | `@` | `185.199.108.153` | DNS only (grey cloud) | Auto |
| A | `@` | `185.199.109.153` | DNS only (grey cloud) | Auto |
| A | `@` | `185.199.110.153` | DNS only (grey cloud) | Auto |
| A | `@` | `185.199.111.153` | DNS only (grey cloud) | Auto |

All four. They are GitHub Pages' anycast addresses and the redundancy is the
point.

### 3c. Point `www` at GitHub

| Type | Name | Target | Proxy status | TTL |
|---|---|---|---|---|
| CNAME | `www` | `liubov-personal-use.github.io` | DNS only (grey cloud) | Auto |

Note: the target is the **account** domain with no repository path and no
trailing slash. Delete any existing `www` record first.

### 3d. Proxy status — recommendation

**Start with DNS only (grey cloud) on all five records.**

GitHub Pages issues its own Let's Encrypt certificate, and it does that by
answering an HTTP challenge on your domain. With Cloudflare's proxy on
(orange cloud), that challenge is intercepted and certificate issuance either
fails or hangs — the single most common reason "Enforce HTTPS" stays greyed
out. Grey cloud also means the certificate GitHub serves is the one visitors
actually get, so there is one less moving part while you verify the cutover.

Once the site is live, HTTPS is enforced, and you have confirmed everything
works, you *may* switch the apex and `www` records to proxied (orange cloud)
for Cloudflare's CDN and analytics. If you do:

- Set **SSL/TLS → Overview → encryption mode** to **Full (strict)**. Anything
  less is either broken (Off / Flexible cause redirect loops against Pages,
  which always redirects to HTTPS) or insecure (Full without strict does not
  validate the origin certificate).
- Do not switch until GitHub has issued the certificate, or you will have to
  grey-cloud it again to let the renewal through.

For a static marketing site on Pages, the CDN benefit is small — Pages is
already behind a CDN. **Grey cloud is a perfectly good permanent answer**, and
it is the lower-risk one.

### 3e. Leave the staging record alone for now

There is a DNS record for `staging.femfast.io` pointing at GitHub Pages.
**Leave it in place through the cutover** — it is the fallback if you need to
compare the new site against the old one while DNS is settling. It gets
deleted in Step 8, after production is verified.

### 3f. Leave everything else alone

Do not touch MX, TXT (SPF/DKIM/DMARC) or any other records. Email and domain
verification are unaffected by this cutover.

---

## Step 4 — Set the custom domain in GitHub

Only after the DNS records above are saved.

1. `femfast-site` → **Settings** → **Pages** → **Custom domain**.
2. Enter `femfast.io` → **Save**.
3. GitHub runs a DNS check. Green tick = the A records resolve. If it errors,
   the records have not propagated yet — wait and press Save again.
4. **The `CNAME` file on `gh-pages` changes from `staging.femfast.io` to
   `femfast.io`** — GitHub rewrites it when you save the new custom domain.
   From then on `npm run deploy` preserves `femfast.io` on every push, exactly
   as it has been preserving `staging.femfast.io`. If you would rather set it
   from the command line than the UI, `npm run deploy -- --domain femfast.io`
   does the same thing.
5. Wait for **"Certificate: issued"**. Minutes usually; up to an hour.
6. Tick **Enforce HTTPS**. It stays greyed out until the certificate exists —
   that is the step to be patient about, not to work around.

Setting the apex as the custom domain makes GitHub redirect `www.femfast.io`
to `femfast.io` automatically, given the CNAME in 3c.

---

## Step 5 — Propagation

| What | How long |
|---|---|
| Cloudflare DNS edits | seconds (Cloudflare is authoritative and publishes immediately) |
| Resolvers elsewhere honouring the old record | up to the old record's TTL — usually 5 min to 1 hour, up to 24 h if it was set high |
| GitHub's DNS check passing | 1–15 minutes after the records are live |
| Let's Encrypt certificate issuance | 1 minute to 1 hour |
| **Realistic end-to-end** | **15–60 minutes**, with stragglers on stale caches for a few hours |

Lower the TTL on the existing Tilda records to 5 minutes (300) *a day before*
the cutover if you want the window as short as possible.

---

## Step 6 — Verification checklist

Work through this after the certificate is issued. Use a browser you have not
opened the site in, or a private window, so you are not reading cache.

**DNS**

- [ ] `dig +short femfast.io` returns the four `185.199.10[89].153` /
      `185.199.11[01].153` addresses
- [ ] `dig +short www.femfast.io` returns `liubov-personal-use.github.io`
- [ ] `curl -sI https://femfast.io | head -1` returns `HTTP/2 200`

**HTTPS**

- [ ] `https://femfast.io` loads with a valid certificate, no warning
- [ ] `http://femfast.io` redirects to `https://`
- [ ] `https://www.femfast.io` redirects to `https://femfast.io`
- [ ] GitHub Pages settings show **Enforce HTTPS** ticked

**Every route returns 200 and looks right**

- [ ] `https://femfast.io/`
- [ ] `https://femfast.io/checkin/`
- [ ] `https://femfast.io/help/`
- [ ] `https://femfast.io/contact/`
- [ ] `https://femfast.io/privacy/`
- [ ] `https://femfast.io/terms/`

**The old Tilda links still work** (the App Store listing points at one of
these — check the listing itself and confirm the exact path is covered)

- [ ] `https://femfast.io/privacy-policy` lands on `/privacy/`
- [ ] `https://femfast.io/terms-of-use` lands on `/terms/`
- [ ] `https://femfast.io/contacts` lands on `/contact/`
- [ ] A path that genuinely does not exist shows the 404 page, not a blank

**The site works**

- [ ] Landing page: the cycle wheel animates, dragging it changes the day, and
      the four phase pills change the tiles
- [ ] The FAQ opens and closes
- [ ] `/checkin/` runs all six questions, shows the loading screen, then a
      result with a fasting window, an "Adjusted for" chip and row tags
- [ ] No errors in the browser console on any route
- [ ] Check it on a real phone, not just a narrow browser window

**Search and social**

- [ ] `https://femfast.io/robots.txt` and `/sitemap.xml` both load
- [ ] Paste `https://femfast.io` into Slack or iMessage and confirm the
      preview shows a title, description and image
- [ ] Submit the sitemap in Google Search Console

**Scores**

- [ ] `npm run lighthouse -- https://femfast.io` — expect the same shape as
      local: everything 100 except the landing page around 92 performance,
      96 accessibility, 92 SEO

---

## Step 7 — Rollback

**One line: in Cloudflare, delete the four GitHub A records and restore the
Tilda A record(s) you saved in Step 3a (and the original `www` record).**

DNS is the only thing that changed, so undoing it is the whole rollback.
Traffic returns to Tilda within the TTL — minutes, if you lowered it first.
The Tilda site is never modified by any of this and keeps working throughout.

If you also want GitHub to stop claiming the domain, clear the **Custom
domain** field in Settings → Pages. Not urgent; an unclaimed custom domain
does no harm once DNS points elsewhere.

---

## Step 8 — Retire staging

Once production is verified and you are no longer holding rollback open:

1. **Delete the `staging.femfast.io` DNS record in Cloudflare.** Nothing
   points at it after cutover — the custom domain moved to `femfast.io` in
   Step 4, so `staging.femfast.io` would otherwise resolve to a Pages site
   that no longer claims it and serve a 404.
2. Optionally re-point it at Pages again later if you want a staging
   environment back; that means a second repository, since one Pages site
   serves one custom domain.

Do this **after** Step 6 passes and after you are past the point of wanting
the one-line rollback, not before.

---

## After the dust settles

- Keep Tilda alive for a week or two before cancelling, so rollback stays
  one DNS edit away.
- `/legal/tilda-meta.txt` records the one thing that could not be captured:
  the live site's meta title, description and OG image. Fill those in and put
  them into `src/site.config.mjs` if you want the original wording back —
  after checking they contain neither "diet" nor "weight loss".
- Re-check `data/rating.json` when the App Store figures move. It is marked
  manual for exactly that reason.
