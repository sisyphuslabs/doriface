// The sidebar with Spaces on top and Agents docked at the bottom (#383, #384, #397), in both themes at 1440 and 390:
// CAPTURE=1 CAPTURE_DIR=<dir> bunx playwright test sidebar-capture
import { devices } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";

const { defaultBrowserType: _browser, ...PHONE } = devices["iPhone 14"];
const OUT = process.env["CAPTURE_DIR"] ?? join(import.meta.dirname, "../../../docs/design/app");

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ serviceWorkers: "block" });

const started: string[] = [];
let dir = "";

test.beforeAll(() => {
  dir = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "capture-"));
  started.push(startAgent("host", "reviewer", "working", "api"), startAgent("host", "planner", "idle", "web"));
  for (const parent of ["home", "data"]) {
    const cwd = join(dir, parent, "notes");
    mkdirSync(cwd, { recursive: true });
    const out: unknown = JSON.parse(
      hcOn("host", ["run", "--bg", "--name", `notes-${parent}`, "--cwd", cwd, "--", "sh", "-c", "exec sleep 600"]),
    );
    if (typeof out === "object" && out !== null && "address" in out) started.push(String(out.address));
  }
});
test.afterAll(() => {
  for (const address of started.splice(0)) endAgent("host", address);
  rmSync(dir, { recursive: true, force: true });
});

for (const width of ["1440", "390"] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`${width} ${colorScheme}`, () => {
      test.use({
        ...(width === "1440" ? { viewport: { width: 1440, height: 900 } } : PHONE),
        colorScheme,
      });
      test(`sidebar ${width} ${colorScheme}`, async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText("reviewer").first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(/notes · data/).first()).toBeVisible({ timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(OUT, `sidebar-${width}-${colorScheme}.png`) });
      });
    });
  }
}
