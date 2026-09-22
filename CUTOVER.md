# Cutover — femfast.io from Tilda to GitHub Pages

**Done.** `femfast.io` and `www.femfast.io` are live on GitHub Pages, confirmed
22 September 2026, with both production checks run against the live host.
Tilda no longer serves the domain.

This was a runbook. It is now the record of what changed, the rollback while it
is still worth holding open, and the one step left.

---

## Still to do

- [ ] **Delete the `staging.femfast.io` DNS record** in Cloudflare — [Step 8](#step-8--retire-staging)
- [ ] Leave Tilda alive a week or two, so the rollback stays one DNS edit away

Everything else is done:

- [x] DNS cut over, certificate issued, Enforce HTTPS on
- [x] Every address resolves on the live host — including `/privacypolicy` and
      `/termsofuse`, which the App Store listing links to and which had to
      answer 200 rather than redirect
- [x] Lighthouse run against production

```bash
npm run urls -- https://femfast.io        # every address, incl. the App Store's
npm run lighthouse -- https://femfast.io
```

Re-run both after any deploy.

---

## Where things stand

| | |
|---|---|
| Live at | <https://femfast.io> and <https://www.femfast.io> |
| Served by | GitHub Pages, from `gh-pages` in [`femfast-site`](https://github.com/Liubov-personal-use/femfast-site) |
| Custom domain | `femfast.io` — the `CNAME` file on `gh-pages` |
| DNS | Cloudflare |
| Previous origin | Tilda — still running, no longer pointed at |
| Staging | retired; `staging.femfast.io` now 404s until its record is deleted |

`femfast-site` is the only repository that matters. The session repo
`femfast-landing-page` held the same commits and has no Pages configuration.

---

## What changed

Only DNS and one GitHub setting. No change was made to Tilda.

### Cloudflare DNS

Apex `femfast.io` — the Tilda **A** and **AAAA** records were removed and
replaced with GitHub Pages' four anycast addresses:

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| A | `@` | `185.199.108.153` | DNS only (grey cloud) | Auto |
| A | `@` | `185.199.109.153` | DNS only (grey cloud) | Auto |
| A | `@` | `185.199.110.153` | DNS only (grey cloud) | Auto |
| A | `@` | `185.199.111.153` | DNS only (grey cloud) | Auto |

| Type | Name | Target | Proxy status | TTL |
|---|---|---|---|---|
| CNAME | `www` | `liubov-personal-use.github.io` | DNS only (grey cloud) | Auto |

MX and TXT records (SPF/DKIM/DMARC) were not touched, so mail and domain
verification are unaffected.

### GitHub Pages

Custom domain set to `femfast.io`, Enforce HTTPS on. Saving that rewrote the
`CNAME` file on `gh-pages` from `staging.femfast.io` to `femfast.io` — commit
`2c44183`, "Update CNAME", sitting on top of the last deploy. That file *is* the
custom domain; see [Publishing](#publishing-a-change).

Setting the apex as the custom domain is what makes GitHub redirect
`www.femfast.io` to `femfast.io`, given the `www` CNAME above.

### On the proxy status

All five records are **DNS only (grey cloud)**, which is what the certificate
needed: GitHub issues its own Let's Encrypt certificate by answering an HTTP
challenge on the domain, and Cloudflare's proxy intercepts that challenge —
the most common reason "Enforce HTTPS" stays greyed out.

You *may* switch the apex and `www` to proxied (orange cloud) now that the
certificate exists. If you do:

- Set **SSL/TLS → Overview → encryption mode** to **Full (strict)**. Anything
  less is either broken (Off / Flexible cause redirect loops against Pages,
  which always redirects to HTTPS) or insecure (Full without strict does not
  validate the origin certificate).
- Expect to grey-cloud it again when the certificate comes up for renewal.

For a static site already behind Pages' CDN the benefit is small. **Grey cloud
is a perfectly good permanent answer**, and it is the lower-risk one.

---

## Rollback — still open

**One line: in Cloudflare, delete the four GitHub A records, restore the Tilda
A record(s) and the original `www` record.**

DNS is the only thing that changed, so undoing it is the whole rollback.
Traffic returns to Tilda within the TTL. The Tilda site was never modified and
still works.

This stays available for as long as you keep Tilda alive. Once you cancel it,
the rollback goes with it.

If you also want GitHub to stop claiming the domain, clear the **Custom
domain** field in Settings → Pages. Not urgent; an unclaimed custom domain does
no harm once DNS points elsewhere.

---

## Step 8 — Retire staging

`staging.femfast.io` still has a DNS record pointing at GitHub Pages, but the
custom domain moved to `femfast.io`, so Pages no longer claims that hostname
and serves a 404 on it.

1. **Delete the `staging.femfast.io` record in Cloudflare.**
2. If you want a staging environment back later, that means a second
   repository — one Pages site serves one custom domain.

Do this once you are past wanting the one-line rollback.

---

## Publishing a change

```bash
npm run build && npm run check && npm run verify
npm run deploy
```

**Use `npm run deploy`. Do not rebuild `gh-pages` by hand.**

The custom domain is not held in settings somewhere safe — it lives in the
`CNAME` file on the served branch. Any publish that rebuilds `gh-pages` from
`/dist` deletes it, which unsets the custom domain and takes the site off
femfast.io until someone notices.

`npm run deploy` reads the `CNAME` already on the remote branch and writes it
back, so the domain survives every push. It commits on top of the branch rather
than force-pushing a fresh history, so GitHub's own "Update CNAME" commit stays
in the log. `npm run deploy -- --dry-run` shows what would change and pushes
nothing.

GitHub writes `CNAME` without a trailing newline and the build writes one with;
`deploy.mjs` matches GitHub's byte-for-byte, so the file does not churn.

Pages serves only the **root** of a branch or a `/docs` folder — it cannot be
pointed at `/dist`. Hence two branches: `main` holds the source with `/dist` as
the canonical build output, `gh-pages` is the serving copy.

> The alternative is a GitHub Actions workflow that builds and deploys on every
> push. That was deliberately not added — you asked for no Actions.

---

## Verifying after a change

```bash
npm run urls -- https://femfast.io
```

resolves every address that has to work and reports mixed content. The two that
matter most are the App Store's, which must answer 200 with the policy on them
rather than redirect anywhere:

- `https://femfast.io/privacypolicy` — bare and trailing-slash
- `https://femfast.io/termsofuse` — bare and trailing-slash

`/privacy/` and `/terms/` land on them. Also worth an eye by hand: the cycle
wheel drags and its pills change the tiles, the FAQ opens, `/checkin/` runs all
six questions through to a result, and the console is clean. On a real phone,
not just a narrow window.

```bash
npm run lighthouse -- https://femfast.io
```

Expect the local shape: everything 100 except the landing page, around 92
performance and 96 accessibility.

---

## After the dust settles

- Submit `https://femfast.io/sitemap.xml` in Google Search Console.
- Paste `https://femfast.io` into Slack or iMessage and confirm the preview
  shows a title, description and image.
- `legal/tilda-meta.txt` records the one thing that could not be captured: the
  old site's meta title, description and OG image. Fill them into
  `src/site.config.mjs` if you want the original wording back — after checking
  they contain neither "diet" nor "weight loss".
- Re-check `data/rating.json` when the App Store figures move. It is marked
  manual for exactly that reason.
