import { _electron as electron, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchHcSession } from "./hc-session.ts";
import { appArgs, appDir, packagedExecutable } from "./launch.ts";

test.skip(process.platform !== "linux", "Mesa's GL driver is the Linux GPU process's");

test("the window is shown and captured while the system GL driver is slow to load", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-gl-driver-"));
  const hc = scratchHcSession();
  try {
    const shim = join(dir, "slow-gl-driver.so");
    execFileSync("cc", ["-shared", "-fPIC", "-O2", "-o", shim, join(appDir, "e2e", "slow-gl-driver.c"), "-ldl"]);
    const env = Object.fromEntries(
      Object.entries({
        ...process.env,
        ...hc.env,
        LD_PRELOAD: shim,
        // Longer than the screenshot's own 30 s timeout, so waiting on the driver cannot pass.
        DORIFACE_E2E_SLOW_GL_SECONDS: "120",
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const args = appArgs([`--user-data-dir=${join(dir, "profile")}`]);
    const app = await electron.launch({
      ...(packagedExecutable === undefined
        ? { args }
        : { executablePath: join(appDir, "e2e", "attach-after-first-load.ts"), args }),
      env,
    });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector("#root > *");
      // A capture needs a presented frame of the shown window, which the app shows once its first frame is ready.
      await page.screenshot({ path: test.info().outputPath("gl-driver.png") });
    } finally {
      await app.close();
    }
  } finally {
    await hc.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
