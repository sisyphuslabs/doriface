# doriterm.com

The public landing page: one hand-written HTML document and one stylesheet, with no JavaScript, no font download and no
third-party request. `build.ts` copies the page, hashes the stylesheet and the images into `dist/`, and fails the build if
an image has no `width`/`height`, an asset is never referenced, or the social card is not 1200x630.

```sh
bun run --cwd apps/landing build     # dist/, ~1 s
bunx serve apps/landing/dist         # or any static server, to look at it
```

The page follows `prefers-color-scheme`; there is no toggle and no script that sets a theme. The design decisions, the
page brief and the layout line are in [docs/design/landing/DESIGN-LANDING.md](../../docs/design/landing/DESIGN-LANDING.md),
and the screenshots it shows are the app's own captures under `docs/design/app/`.

## Deploying

`wrangler.jsonc` serves `dist/` as Workers static assets with no Worker code, on the custom domain `doriterm.com`.
`.github/workflows/deploy-landing.yml` runs by hand (`workflow_dispatch`) because the zone record has to exist first:

1. In the Cloudflare account that holds the repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, add the
   `doriterm.com` zone, or ask its owner to add these records in the zone that already holds `omo.dev`:
   - `doriterm.com` — the apex belongs to this Worker's custom domain, so no `A`/`AAAA`/`CNAME` record may already exist
     there; the Workers custom-domain flow creates the proxied record itself.
   - `www.doriterm.com` — a proxied `CNAME` to `doriterm.com` (or a redirect rule), so the `www` host resolves.
2. Run **Deploy landing** on `dev`. It builds, deploys, and probes `https://doriterm.com/` for the headline.
3. Point the app at its own host: `app.doriterm.com` is the web app (`apps/web`), served by that package's own deploy.

The social card is `src/static/og.png`, served at `/og.png` and referenced by absolute URL. To change it, edit
`docs/design/landing/og-card.html` and re-render it:

```sh
bunx playwright screenshot --viewport-size="1200,630" \
  "file://$PWD/docs/design/landing/og-card.html" apps/landing/src/static/og.png
```
