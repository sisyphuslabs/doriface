import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { openPhoneTerminal, PHONE } from "./phone-key-bar.ts";
import { pointOn, rowEnd } from "./terminal-points.ts";
import { Touch } from "./touch.ts";

test.use({ serviceWorkers: "block", ...PHONE, permissions: ["clipboard-read", "clipboard-write"] });

const painted = (page: Page) => page.locator(".term-selection-cells > div");
const menu = (page: Page) => page.getByRole("menu", { name: "Selected text" });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());


test("a held touch selects the word under the finger, and Copy puts it on the clipboard", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  await page.keyboard.type("printf 'pick-%s\\n' alpha\r");
  await expect(terminal).toContainText("pick-alpha", { timeout: 15_000 });
  await page.evaluate(() => navigator.clipboard.writeText("nothing"));
  await expect(painted(page)).toHaveCount(0);

  const word = await pointOn(terminal, "pick-alpha", "alpha");
  const touch = await Touch.on(page);
  await touch.down(word);
  await expect(painted(page).first()).toBeVisible();
  await touch.up(word);

  await expect(menu(page)).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Copy" }).click();
  await expect.poll(() => clipboard(page)).toBe("alpha");
  // The selection stays after the copy, as a terminal's does; a press elsewhere lets it go.
  await expect(painted(page).first()).toBeVisible();
});

test("a drag after the hold reaches the row's end, and Copy takes what it reached", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  await page.keyboard.type("printf 'drag-%s\\n' 'alpha beta gamma'\r");
  await expect(terminal).toContainText("drag-alpha beta gamma", { timeout: 15_000 });
  await page.evaluate(() => navigator.clipboard.writeText("nothing"));

  const word = await pointOn(terminal, "drag-alpha beta gamma", "beta");
  const end = await rowEnd(terminal, "drag-alpha beta gamma");
  const touch = await Touch.on(page);
  await touch.down(word);
  await expect(painted(page).first()).toBeVisible();
  await touch.drag(word, end);
  await touch.up(end);
  await menu(page).getByRole("menuitem", { name: "Copy" }).click();
  await expect.poll(() => clipboard(page)).toBe("beta gamma");
});

test("a tap still types and a swipe still scrolls the scrollback", async ({ page }) => {
  const terminal = await openPhoneTerminal(page);
  const touch = await Touch.on(page);
  const viewport = page.locator("[data-slot=terminal-viewport]");

  const prompt = await pointOn(terminal, "$", "$");
  await touch.tap(prompt);
  await expect(page.locator("[data-terminal] textarea")).toBeFocused();
  await expect(painted(page)).toHaveCount(0);
  await page.keyboard.type("echo tap-$((2+2))");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("tap-4", { timeout: 15_000 });

  await page.keyboard.type("seq 1 200\r");
  await expect(terminal).toContainText("200", { timeout: 15_000 });
  const before = await viewport.evaluate((el) => el.scrollTop);
  await expect.poll(() => before).toBeGreaterThan(0);
  const last = await pointOn(terminal, "200", "200");
  await touch.down(last);
  await touch.drag(last, { x: last.x, y: last.y + 260 });
  await touch.up({ x: last.x, y: last.y + 260 });
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeLessThan(before);
  await expect(painted(page)).toHaveCount(0);
});
