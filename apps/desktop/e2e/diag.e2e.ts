import { _electron as electron, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchHcSession } from "./hc-session.ts";
import { appDir } from "./launch.ts";

const wrapper = join(appDir, "e2e", "attach-after-first-load.ts");
const MODE = process.env["DIAG_MODE"] ?? "launch"; // launch = as launch.e2e; noreload = skip page.reload
const TRACE = process.env["DIAG_TRACE"] === "1";

const state = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w === undefined) return { windows: 0 };
    return {
      windows: BrowserWindow.getAllWindows().length,
      visible: w.isVisible(),
      minimized: w.isMinimized(),
      focused: w.isFocused(),
      bounds: w.getBounds(),
      painting: w.webContents.isPainting(),
      throttling: w.webContents.getBackgroundThrottling(),
      shownAt: Reflect.get(globalThis, "__diagShownAt"),
      raced: Reflect.get(globalThis, "__diagRaced"),
      readyAt: Reflect.get(globalThis, "__diagReadyAt"),
      now: Date.now(),
    };
  });

test("diag screenshot", async () => {
  test.setTimeout(120_000);
  const hc = scratchHcSession();
  const profile = mkdtempSync(join(tmpdir(), "diag-profile-"));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...hc.env }).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const t0 = Date.now();
  const app = await electron.launch({ executablePath: wrapper, args: [`--user-data-dir=${profile}`], env });
  try {
    const launchedMs = Date.now() - t0;
    // record when the window becomes visible, from now on
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w === undefined) return;
      if (w.isVisible()) Reflect.set(globalThis, "__diagShownAt", "before-attach");
      else if (process.env["DIAG_MODE"] === "racereload") {
        Reflect.set(globalThis, "__diagRaced", true);
        w.webContents.reload();
      } else if (process.env["DIAG_MODE"] === "noshow") {
        w.removeAllListeners("ready-to-show");
        Reflect.set(globalThis, "__diagSuppressed", true);
      }
      w.once("show", () => Reflect.set(globalThis, "__diagShownAt", Date.now()));
      w.once("ready-to-show", () => Reflect.set(globalThis, "__diagReadyAt", Date.now()));
    });
    const page = await app.firstWindow();
    const s0 = await state(app);
    console.log(
      `DIAG-GPU ${JSON.stringify(await app.evaluate(({ app: electronApp }) => electronApp.getGPUFeatureStatus()))}`,
    );
    if (MODE === "early") {
      const te = Date.now();
      let early = "ok";
      try {
        await page.screenshot({ timeout: 10_000 });
      } catch (e) {
        early = String(e).split("\\n")[0] ?? "error";
      }
      console.log(`DIAG-EARLY ${JSON.stringify({ early, ms: Date.now() - te, before: s0, after: await state(app) })}`);
    }
    if (MODE !== "noreload") await page.reload();
    await page.waitForSelector("#root > *");
    const s1 = await state(app);
    const doc = await page.evaluate(() => ({ vis: document.visibilityState, focus: document.hasFocus() }));
    if (TRACE)
      await app.evaluate(({ contentTracing }) =>
        contentTracing
          .startRecording({
            included_categories: [
              "viz",
              "cc",
              "gpu",
              "ui",
              "renderer",
              "devtools",
              "disabled-by-default-devtools.timeline.frame",
              "benchmark",
              "toplevel",
            ],
          })
          .then(() => undefined),
      );
    const ts = Date.now();
    let shot = "ok";
    try {
      await page.screenshot({
        path: test.info().outputPath("diag.png"),
        timeout: Number(process.env["DIAG_SHOT_TIMEOUT"] ?? 30_000),
      });
    } catch (e) {
      shot = String(e).split("\n")[0] ?? "error";
    }
    const shotMs = Date.now() - ts;
    const s2 = await state(app);
    if (MODE === "noshow") {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show());
      const ta = Date.now();
      let after = "ok";
      try {
        await page.screenshot({ timeout: 10_000 });
      } catch (e) {
        after = String(e).split("\\n")[0] ?? "error";
      }
      console.log(`DIAG-AFTERSHOW ${JSON.stringify({ after, ms: Date.now() - ta, state: await state(app) })}`);
    }
    let tracePath: string | undefined;
    if (TRACE)
      tracePath = await app.evaluate(
        ({ contentTracing }, p) => contentTracing.stopRecording(p),
        test.info().outputPath("trace.json"),
      );
    console.log(`DIAG ${JSON.stringify({ mode: MODE, launchedMs, s0, s1, doc, shot, shotMs, s2, tracePath })}`);
  } finally {
    await app.close();
    await hc.dispose();
  }
});
