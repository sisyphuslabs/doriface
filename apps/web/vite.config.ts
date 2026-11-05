import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { day, night, resolveTheme } from "../../packages/ui/src/theme/index.ts";

const dayTheme = resolveTheme(day);
const nightTheme = resolveTheme(night);

/** The browser's title/status bar colour per system scheme; the app re-points both to the theme in view at start. */
const themeColor = {
  name: "doriface-theme-color",
  transformIndexHtml: () =>
    [
      { media: "(prefers-color-scheme: light)", content: dayTheme.roles.chrome },
      { media: "(prefers-color-scheme: dark)", content: nightTheme.roles.chrome },
    ].map((attrs) => ({ tag: "meta", attrs: { name: "theme-color", ...attrs }, injectTo: "head" as const })),
};

export default defineConfig({
  plugins: [
    react(),
    themeColor,
    tailwindcss(),
    VitePWA({
      // A new worker waits for Reload to update in Settings (src/sw.ts takes SKIP_WAITING from updateSW).
      registerType: "prompt",
      // Our own worker (src/sw.ts): the same precache as before, plus the push and notification-click handlers.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icon.svg", "favicon.svg", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "doriface",
        short_name: "doriface",
        description: "Your terminals and agents, from any device.",
        display: "standalone",
        start_url: "/",
        scope: "/",
        // One theme for both, matching the light metas a first launch starts with.
        background_color: dayTheme.roles.background,
        theme_color: dayTheme.roles.chrome,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,wasm,woff2}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  build: { target: "es2023" },
});
