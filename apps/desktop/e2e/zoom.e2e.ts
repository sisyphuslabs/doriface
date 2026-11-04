import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchHcSession } from "./hc-session.ts";
import { launchOptions } from "./launch.ts";

interface Scratch {
  readonly hc: ReturnType<typeof scratchHcSession>;
  readonly profile: string;
  readonly shellHome: string;
  readonly env: Record<string, string>;
}
let scratch: Scratch | undefined;
let launched: ElectronApplication | undefined;

// One app, one profile: the last test relaunches it to read the zoom it saved.
test.describe.configure({ mode: "serial" });

const launch = (): Promise<ElectronApplication> => {
  if (scratch === undefined) throw new Error("no scratch session");
  return electron.launch({ ...launchOptions([`--user-data-dir=${scratch.profile}`]), env: scratch.env });
};

test.beforeAll(async () => {
  const hc = scratchHcSession();
  const profile = mkdtempSync(join(tmpdir(), "dd-profile-"));
  const shellHome = mkdtempSync(join(tmpdir(), "dd-shell-"));
  writeFileSync(join(shellHome, "clean-shell"), "#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n", { mode: 0o755 });
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...hc.env,
      SHELL: "clean-shell",
      PATH: `${shellHome}:${process.env["PATH"] ?? ""}`,
      HOME: shellHome,
      PS1: "$ ",
      ENV: "",
      BASH_SILENCE_DEPRECATION_WARNING: "1",
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  scratch = { hc, profile, shellHome, env };
  launched = await launch();
});

test.afterAll(async () => {
  try {
    await launched?.close();
  } finally {
    if (scratch !== undefined) {
      await scratch.hc.dispose();
      rmSync(scratch.profile, { recursive: true, force: true });
      rmSync(scratch.shellHome, { recursive: true, force: true });
    }
  }
});

const app = (): ElectronApplication => {
  if (launched === undefined) throw new Error("the app did not launch");
  return launched;
};

const zoomFactor = (): Promise<number> =>
  app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0);

const clickMenuItem = (id: string): Promise<void> =>
  app().evaluate(({ BrowserWindow, Menu }, wanted) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(wanted);
    if (item === null || item === undefined) throw new Error(`the app menu has no ${wanted} item`);
    item.click(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);

const terminalIn = (page: Page) => page.locator('[data-focused="true"] [data-terminal]');

const drawn = (page: Page) =>
  terminalIn(page).evaluate((element) => {
    const rows = element.querySelectorAll(".term-row:not(.term-scrollback-row)");
    const rowStyle = getComputedStyle(rows[0] ?? element);
    const context = document.createElement("canvas").getContext("2d");
    if (context === null) throw new Error("no 2d canvas");
    context.font = `${rowStyle.fontWeight} ${rowStyle.fontSize} ${rowStyle.fontFamily}`;
    let transformedAncestors = 0;
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).transform !== "none") transformedAncestors += 1;
    }
    return {
      grid: `${rows.length} ${rows[rows.length - 1]?.textContent?.length ?? 0}`,
      rows: rows.length,
      cols: rows[rows.length - 1]?.textContent?.length ?? 0,
      dpr: devicePixelRatio,
      cssWidth: innerWidth,
      cellDevicePx: parseFloat(getComputedStyle(element).getPropertyValue("--term-cell-width")) * devicePixelRatio,
      fontSize: getComputedStyle(element).getPropertyValue("--term-font-size").trim(),
      // Against the font's own advance, which no layout or transform can distort.
      cellMinusAdvance:
        parseFloat(getComputedStyle(element).getPropertyValue("--term-cell-width")) - context.measureText("W").width,
      transformedAncestors,
    };
  });

/** The pty size the core holds for the focused terminal, as "rows cols". */
async function coreGrid(page: Page): Promise<string> {
  const address = (await terminalIn(page).getAttribute("data-terminal")) ?? "";
  const hc = process.env["HC_BIN"] ?? "hc";
  const terminal: unknown = JSON.parse(
    execFileSync(hc, ["get", address, "--json"], { env: scratch?.env, encoding: "utf8" }),
  );
  if (typeof terminal !== "object" || terminal === null || !("rows" in terminal) || !("cols" in terminal)) {
    throw new Error(`hc get ${address} printed no size`);
  }
  return `${String(terminal.rows)} ${String(terminal.cols)}`;
}

test("the zoom keys zoom the whole window and the terminal refits to it", async () => {
  const page = await app().firstWindow();
  await page.getByRole("button", { name: "Use this computer" }).click();
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click({ timeout: 30_000 });
  await expect(terminalIn(page)).toContainText("$", { timeout: 30_000 });
  expect(await zoomFactor()).toBe(1);
  const before = await drawn(page);
  expect(Math.abs(before.cellMinusAdvance)).toBeLessThan(0.05);
  expect(before.transformedAncestors).toBe(0);

  await terminalIn(page).getByRole("textbox").focus();
  await page.keyboard.press("ControlOrMeta+Minus");
  await expect.poll(zoomFactor).toBe(0.9);
  // wterm swaps the grid's row elements a frame before it redraws their text: wait until the refit is whole and the core
  // holds it, so one read cannot pair the new row count with the old column count.
  const refit = async (): Promise<boolean> => {
    const now = await drawn(page);
    const grown = now.rows > before.rows && now.cols > before.cols;
    return grown && Math.abs(now.cellMinusAdvance) < 0.05 && (await coreGrid(page)) === now.grid;
  };
  await expect.poll(refit, { timeout: 15_000 }).toBe(true);
  const after = await drawn(page);
  // The window zoomed, not only the terminal: the page lays out more CSS pixels on the same screen.
  expect(after.dpr).toBeCloseTo(before.dpr * 0.9, 3);
  expect(after.cssWidth).toBeGreaterThan(before.cssWidth);
  expect(after.cols).toBeGreaterThan(before.cols);
  expect(after.cellDevicePx).toBeLessThan(before.cellDevicePx);
  expect(Math.abs(after.cellMinusAdvance)).toBeLessThan(0.05);
  expect(after.transformedAncestors).toBe(0);
  // One zoom: the configured terminal font size is left as it was.
  expect(after.fontSize).toBe(before.fontSize);

  await page.keyboard.press("ControlOrMeta+0");
  await expect.poll(zoomFactor).toBe(1);
  await expect.poll(async () => (await drawn(page)).grid).toBe(before.grid);
});

test("View > Zoom Out, Zoom In and Actual Size drive the same window zoom as the keys", async () => {
  await clickMenuItem("zoom-out");
  await expect.poll(zoomFactor).toBe(0.9);
  await clickMenuItem("zoom-out");
  await expect.poll(zoomFactor).toBe(0.8);
  await clickMenuItem("zoom-in");
  await expect.poll(zoomFactor).toBe(0.9);
  await clickMenuItem("zoom-reset");
  await expect.poll(zoomFactor).toBe(1);
  await clickMenuItem("zoom-out");
  await expect.poll(zoomFactor).toBe(0.9);
});

test("the window opens at the zoom it was left at", async () => {
  await app().close();
  launched = await launch();
  const page = await app().firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(zoomFactor).toBe(0.9);
  await clickMenuItem("zoom-reset");
  await expect.poll(zoomFactor).toBe(1);
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1);
});
