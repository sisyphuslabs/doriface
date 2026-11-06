# doriterm.com

The landing page for doriterm.com. The app itself is `apps/web`, served at app.doriterm.com.

```sh
bun run --cwd apps/landing dev       # Vite dev server
bun run --cwd apps/landing build     # dist/: static files for any host, _headers included
bun run --cwd apps/landing preview   # serve dist/
```

- `index.html`, `styles.css`, `main.js`: the page. Plain HTML and CSS, one small module for the theme switch, the scene animations and the mockup frames.
- `mockup.html`, `src/mockup/`: the app's own components from `@doriface/ui` with sample data, shown on the page in lazy iframes.
- `public/`: files served at fixed paths (`_headers`, `og.png`, `robots.txt`, `sitemap.xml`, icons, the pre-paint `theme-init.js`, and `fonts/OFL-*.txt`, the licences of Geist and JetBrains Mono, which ship as `dist/fonts/OFL-*.txt`; the font files themselves are hashed into `dist/assets/`).

The design system, the product rulings the copy follows, and the source line behind every claim on the page are in [docs/design/landing/DESIGN-LANDING.md](../../docs/design/landing/DESIGN-LANDING.md). Deploying `dist/` to doriterm.com belongs to the hosting work in #668.
