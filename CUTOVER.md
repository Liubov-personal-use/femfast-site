# Cutover — moving femfast.io from Tilda to GitHub Pages

**No DNS change has been made and no custom domain has been set.** The live
Tilda site is untouched and keeps serving femfast.io until you change DNS
yourself.

Step 0 is done — the repository exists and both branches are pushed.
Everything from Step 1 on is yours to do.

Read the whole thing once before starting. The DNS change is the only step
that is visible to the public, and it is the last one.

---

## Before you start

| | |
|---|---|
| GitHub account | `Liubov-personal-use` |
| Repository | [`femfast-site`](https://github.com/Liubov-personal-use/femfast-site) — `main` (source) + `gh-pages` (served) |
| Staging URL (once Pages is on) | `https://liubov-personal-use.github.io/femfast-site/` |
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

To publish a change later:

```bash
npm run build && npm run check && npm run verify   # in the source repo
```

then republish `gh-pages` from the rebuilt `/dist`:

```bash
cd /tmp && rm -rf ghp && mkdir ghp
cp -r /path/to/femfast-site/dist/. ghp/
cd ghp && git init -b gh-pages && git add -A && git commit -m "Publish built site"
git remote add site https://github.com/Liubov-personal-use/femfast-site.git
git push -f site gh-pages
```

Pages, when deploying from a branch, only serves the **root** of that branch
or a `/docs` folder — it cannot be pointed at `/dist`. Hence the second
branch. `/dist` on `main` stays the canonical build output; `gh-pages` is
only the serving copy.

> The alternative is a GitHub Actions workflow that builds and deploys on
> every push. That was deliberately not added — you asked for no Actions.

### One thing to know about `CNAME`

`/dist/CNAME` contains `femfast.io`, as it should. It is **deliberately left
out of the `gh-pages` branch for now.**

A `CNAME` file in the served branch *is* how GitHub Pages sets a custom
domain. Publishing it today would make Pages claim `femfast.io` immediately
and redirect the `github.io` URL there — and `femfast.io` still resolves to
Tilda, so staging would be unreachable. You add it at cutover (Step 4 does it
for you).

---

## Step 1 — Turn on GitHub Pages — **you need to do this**

This could not be done for you: the GitHub app this session runs under is not
permitted to create repositories or change Pages settings (`403 Resource not
accessible by integration`). It is four clicks:

1. <https://github.com/Liubov-personal-use/femfast-site/settings/pages>
2. **Build and deployment** → Source: **Deploy from a branch**
3. Branch: **`gh-pages`**, folder: **`/ (root)`** → **Save**
4. Leave **Custom domain empty.** Wait for the "Your site is live at …" banner
   — usually under a minute.

Staging URL: **`https://liubov-personal-use.github.io/femfast-site/`**

---

## Step 2 — Check staging

The site is built for `femfast.io` at the domain root, so a few things read
oddly on the project-path staging URL. **These are expected and disappear the
moment the custom domain is set**, so do not try to fix them:

- absolute links (`/help/`, `/assets/…`) resolve to
  `liubov-personal-use.github.io/help/`, not under `/femfast-site/`, so pages
  will look unstyled and internal links will 404
- `<link rel="canonical">` and the OG tags point at `https://femfast.io/…`

In other words: staging confirms the deploy pipeline works, not that the site
looks right. To see the site as it will actually ship, run it locally — that
is byte-for-byte what `gh-pages` contains:

```bash
npm run build && npx serve dist
```

Once the custom domain is set (Step 4), the staging path problems vanish and
`https://femfast.io` is the real check.

Scores against staging, if you want them:

```bash
npm run lighthouse -- https://liubov-personal-use.github.io/femfast-site
```

Expect performance to read lower there than locally, because every internal
asset 404s on the project path. The meaningful run is against `femfast.io`
after cutover.

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

### 3e. Leave everything else alone

Do not touch MX, TXT (SPF/DKIM/DMARC) or any other records. Email and domain
verification are unaffected by this cutover.

---

## Step 4 — Set the custom domain in GitHub

Only after the DNS records above are saved.

1. `femfast-site` → **Settings** → **Pages** → **Custom domain**.
2. Enter `femfast.io` → **Save**.
3. GitHub runs a DNS check. Green tick = the A records resolve. If it errors,
   the records have not propagated yet — wait and press Save again.
4. GitHub commits a `CNAME` file to `gh-pages` containing `femfast.io`. That
   is expected — it was deliberately kept out until now (see Step 0). If you
   later republish `gh-pages` from `/dist`, the `CNAME` in `/dist` carries the
   same value, so the custom domain survives the republish.
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

## After the dust settles

- Keep Tilda alive for a week or two before cancelling, so rollback stays
  one DNS edit away.
- `/legal/tilda-meta.txt` records the one thing that could not be captured:
  the live site's meta title, description and OG image. Fill those in and put
  them into `src/site.config.mjs` if you want the original wording back —
  after checking they contain neither "diet" nor "weight loss".
- Re-check `data/rating.json` when the App Store figures move. It is marked
  manual for exactly that reason.
