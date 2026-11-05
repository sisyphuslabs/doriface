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

// One app, one profile: the last test relaunches it to read the text size it saved.
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

const chrome = (page: Page) => page.locator("aside [data-titlebar]").first().boundingBox();

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

type Drawn = Awaited<ReturnType<typeof drawn>>;

/**
 * The focused terminal once its grid is whole: its cell width is the font's own advance and the core holds the grid it
 * renders. wterm swaps the grid's row elements a frame before it redraws their text, so one read can pair a new row count
 * with an old column count.
 */
async function settled(page: Page, ready: (now: Drawn) => boolean = () => true): Promise<Drawn> {
  const whole = async (): Promise<boolean> => {
    const now = await drawn(page);
    return ready(now) && Math.abs(now.cellMinusAdvance) < 0.05 && (await coreGrid(page)) === now.grid;
  };
  await expect.poll(whole, { timeout: 15_000 }).toBe(true);
  return drawn(page);
}

/** Points of the configured terminal font size, e.g. "13pt" -> 13. */
const points = (now: Drawn): number => parseFloat(now.fontSize);

/** One text-size step: the font size moves by `delta` points and the window zoom and chrome stay where they were. */
async function step(page: Page, press: () => Promise<void>, from: Drawn, delta: number): Promise<Drawn> {
  const header = await chrome(page);
  await press();
  const now = await settled(page, (next) => points(next) === points(from) + delta);
  expect(await zoomFactor()).toBe(1);
  expect(now.dpr).toBe(from.dpr);
  expect(now.cssWidth).toBe(from.cssWidth);
  expect(now.transformedAncestors).toBe(0);
  if (delta > 0) expect(now.cellDevicePx).toBeGreaterThan(from.cellDevicePx);
  else expect(now.cellDevicePx).toBeLessThan(from.cellDevicePx);
  expect(await chrome(page)).toEqual(header);
  return now;
}

let opened: Drawn | undefined;

test("Cmd/Ctrl + = / - / 0 size the terminal text, not the window", async () => {
  const page = await app().firstWindow();
  await page.getByRole("button", { name: "Use this computer" }).click();
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click({ timeout: 30_000 });
  await expect(terminalIn(page)).toContainText("$", { timeout: 30_000 });
  expect(await zoomFactor()).toBe(1);
  const before = await settled(page);
  opened = before;
  await terminalIn(page).getByRole("textbox").focus();

  const bigger = await step(page, () => page.keyboard.press("ControlOrMeta+Equal"), before, 1);
  const smaller = await step(page, () => page.keyboard.press("ControlOrMeta+Minus"), bigger, -1);
  const smallest = await step(page, () => page.keyboard.press("ControlOrMeta+Minus"), smaller, -1);
  expect(smallest.cols).toBeGreaterThan(before.cols);

  await page.keyboard.press("ControlOrMeta+0");
  const reset = await settled(page, (now) => now.grid === before.grid);
  expect(reset.fontSize).toBe(before.fontSize);
  expect(await zoomFactor()).toBe(1);
});

test("View > Bigger, Smaller and Default Text Size step the same terminal text size as the keys", async () => {
  const page = await app().firstWindow();
  const before = await settled(page);
  const bigger = await step(page, () => clickMenuItem("font-size-increase"), before, 1);
  const smaller = await step(page, () => clickMenuItem("font-size-decrease"), bigger, -1);
  await step(page, () => clickMenuItem("font-size-decrease"), smaller, -1);
  await clickMenuItem("font-size-reset");
  await settled(page, (now) => now.fontSize === before.fontSize);
});

test("the text-size keys leave the window zoom alone on Settings too", async () => {
  const page = await app().firstWindow();
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(page).toHaveURL(/\/settings$/);
  await page.keyboard.press("ControlOrMeta+Minus");
  await page.keyboard.press("ControlOrMeta+Minus");
  await page.keyboard.press("ControlOrMeta+Equal");
  expect(await zoomFactor()).toBe(1);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(opened?.dpr);
  await page.keyboard.press("ControlOrMeta+Comma");
  // One step smaller than at launch, which the next test reads back after a relaunch.
  await expect(page).not.toHaveURL(/\/settings$/);
  await settled(page, (now) => opened !== undefined && points(now) === points(opened) - 1);
});

test("the window opens unzoomed even after an older build saved a window zoom, and keeps the text size", async () => {
  if (scratch === undefined || opened === undefined) throw new Error("no scratch session");
  await app().close();
  // What the window zoom of earlier builds left behind: 67%, which put the title under the window buttons (#388).
  writeFileSync(join(scratch.profile, "window-zoom.json"), JSON.stringify({ factor: 0.67 }));
  launched = await launch();
  const page = await app().firstWindow();
  await page.waitForLoadState("domcontentloaded");
  expect(await zoomFactor()).toBe(1);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(opened.dpr);
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click({ timeout: 30_000 });
  await expect(terminalIn(page)).toContainText("$", { timeout: 30_000 });
  const reopened = await settled(page);
  expect(points(reopened)).toBe(points(opened) - 1);
});
