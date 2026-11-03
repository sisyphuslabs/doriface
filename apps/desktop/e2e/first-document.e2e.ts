import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchHcSession } from "./hc-session.ts";
import { appDir, launchOptions, packagedExecutable } from "./launch.ts";
import { buildPreloadShim } from "./preload-shim.ts";

test.skip(process.platform !== "linux" || packagedExecutable === undefined, "the race is the packaged app's, on Linux");

test("the packaged launch settles when the first navigation's commit event would be lost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-first-document-"));
  const hc = scratchHcSession();
  try {
    const shim = join(dir, "hold-renderer.so");
    buildPreloadShim("hold-renderer.c", shim);
    const launch = launchOptions([`--user-data-dir=${join(dir, "profile")}`]);
    const inner = "executablePath" in launch ? [launch.executablePath, ...launch.args] : launch.args;
    const env = Object.fromEntries(
      Object.entries({
        ...process.env,
        ...hc.env,
        LD_PRELOAD: shim,
        // Far longer than Playwright takes to attach, so an attach that does not wait lands inside the first navigation.
        DORIFACE_E2E_HOLD_RENDERER_MS: "3000",
        DORIFACE_E2E_INNER: JSON.stringify(inner),
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const app = await electron.launch({ executablePath: join(appDir, "e2e", "late-page-enable.ts"), args: [], env });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector("#root > *");
      expect(page.url()).toMatch(/^app:\/\/doriface\//);
    } finally {
      await app.close();
    }
  } finally {
    await hc.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
