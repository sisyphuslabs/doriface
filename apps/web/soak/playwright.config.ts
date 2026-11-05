import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The relay soak (#403): this machine's Chromium runs the web app against a real host reached through a real relay,
 * so unlike the e2e suite it starts no host or core of its own, only the web app.
 */
const PORT = Number(process.env["SOAK_WEB_PORT"] ?? 4173);
/** SOAK_PREBUILT: a build of the web app made beforehand, which is served as it is. */
const PREBUILT = process.env["SOAK_PREBUILT"];
const OUT = PREBUILT ?? join(tmpdir(), `doriface-web-soak-${PORT}-dist`);
const PREVIEW = `bunx --bun vite preview --outDir ${OUT} --host 127.0.0.1 --port ${PORT} --strictPort`;
const minutes = Number(process.env["SOAK_MINUTES"] ?? 30);

export default defineConfig({
  testDir: ".",
  testMatch: "*.soak.ts",
  workers: 1,
  timeout: (minutes + 10) * 60_000,
  reporter: "list",
  outputDir: process.env["SOAK_OUTPUT_DIR"] ?? "soak-results",
  // Chromium's own user agent: a preset would claim one OS everywhere, and the app reads the OS from it.
  use: { browserName: "chromium", baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    command: PREBUILT === undefined ? `bunx --bun vite build --outDir ${OUT} --emptyOutDir && ${PREVIEW}` : PREVIEW,
    cwd: join(import.meta.dirname, ".."),
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
