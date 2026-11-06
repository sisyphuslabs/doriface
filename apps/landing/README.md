# doriterm.com

The public landing page: one hand-written HTML document and one stylesheet, with no JavaScript, no webfont and no
third-party request. The product pictures on it are not screenshots: `build.ts` renders the app's own components from
`@doriface/ui` (the sidebar's sections and rows, the machine headers, the tab strip, the status bar and the phone keys bar)
with fixture data, at build time, through `react-dom/server`, and Tailwind compiles the classes they use over the app's
own tokens. Nothing on the page talks to a host or the network.

`build.ts` then hashes the stylesheets and images into `dist/`, and fails the build if an image has no `width`/`height`,
an asset is never referenced, a mock placeholder is missing, or the social card is not 1200x630.

```sh
bun run --cwd apps/landing build     # dist/
bunx serve apps/landing/dist         # or any static server, to look at it
```

The page follows `prefers-color-scheme`; each mock is rendered once with the app's Day theme and once with Night, and
the stylesheet shows the one that matches. The design decisions, the page brief and the layout line are in
[docs/design/landing/DESIGN-LANDING.md](../../docs/design/landing/DESIGN-LANDING.md).

## Deploying

`wrangler.jsonc` serves `dist/` as Workers static assets with no Worker code, on the custom domain `doriterm.com`.
`.github/workflows/deploy-landing.yml` runs by hand (`workflow_dispatch`):

1. The web app must answer at `https://app.doriterm.com` first: every _Open the app_ on the page goes there, and the
   workflow refuses to deploy while it does not. That origin belongs to the web app's own hosting (#703).
2. In the Cloudflare account that holds the repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the
   `doriterm.com` zone must exist. The apex must have no `A`/`AAAA`/`CNAME` record: the Workers custom domain creates the
   proxied record itself. `www.doriterm.com` wants a proxied `CNAME` to the apex, or a redirect rule.
3. Run **Deploy landing** on `dev`. It builds, deploys, and probes `https://doriterm.com/` for the headline. A failed
   probe fails the job but does not undo the deploy; `bunx wrangler rollback` in `apps/landing` restores the previous
   version.

The social card is `src/static/og.png`, served at `/og.png` and referenced by absolute URL. To change it, edit
`docs/design/landing/og-card.html` and re-render it:

```sh
bunx playwright screenshot --viewport-size="1200,630" \
  "file://$PWD/docs/design/landing/og-card.html" apps/landing/src/static/og.png
```
