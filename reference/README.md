# Frozen baseline — not part of the site

This is the original component export exactly as it arrived, kept for one
purpose: `npm run verify` renders these files and the built site side by side
and diffs the screenshots, which is how we prove the static build is
pixel-identical to what the export used to draw.

Nothing here is served, linked or deployed. `/dist` contains no `.dc.html`
files and loads no runtime — the includes are inlined at build time.

`vendor/` holds React locally so the baseline renders without reaching
unpkg.com. The original fetched React from a CDN at page load, which is one
of the reasons the site was migrated off this runtime.

To delete the baseline once you are satisfied with the migration:

    rm -rf reference/ && npm pkg delete scripts.verify
