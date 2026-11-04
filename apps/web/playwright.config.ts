import { defineConfig, devices } from "@playwright/test";
import { E2E_LAYOUT_PORT, E2E_WEB_PORT } from "./e2e/config.ts";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  workers: 1,
  globalTeardown: "./e2e/leftover-hosts.ts",
  forbidOnly: Boolean(process.env["CI"]),
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Only layout.e2e.ts reads this host, and a file's tests run in one worker, so the workers can share it.
      command: "bun e2e/host.ts layout",
      url: `http://127.0.0.1:${E2E_LAYOUT_PORT}/healthz`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
    {
      command: `bunx --bun vite build && bunx --bun vite preview --host 127.0.0.1 --port ${E2E_WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${E2E_WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
