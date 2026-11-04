import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const strip = (page: Page) => page.getByRole("tablist", { name: "Tabs" });
const tabs = (page: Page) => strip(page).getByRole("tab");
const focusedAddress = (page: Page) =>
  page.locator('[data-focused="true"] [data-terminal]').getAttribute("data-terminal");
const selectedIndex = (page: Page) =>
  tabs(page).evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-selected") === "true"));

/** The strip's order as the terminals ⌘1..⌘N select, then the tab that was selected is selected again. */
async function order(page: Page): Promise<string[]> {
  const count = await tabs(page).count();
  const selected = await selectedIndex(page);
  const addresses: string[] = [];
  for (let position = 1; position <= count; position += 1) {
    await page.keyboard.press(`ControlOrMeta+${position}`);
    await expect(tabs(page).nth(position - 1)).toHaveAttribute("aria-selected", "true");
    addresses.push((await focusedAddress(page)) ?? "");
  }
  await page.keyboard.press(`ControlOrMeta+${selected + 1}`);
  await expect(tabs(page).nth(selected)).toHaveAttribute("aria-selected", "true");
  return addresses;
}

/** Four tabs, the last of them new and selected: the workspace opens one on its own when the core has a live one. */
async function fourTabs(page: Page): Promise<string[]> {
  await page.goto("/");
  await openNewTerminal(page);
  while ((await tabs(page).count()) < 4) await openNewTerminal(page);
  await expect(tabs(page)).toHaveCount(4);
  return order(page);
}

const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the tab has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, right: box.x + box.width };
};

async function dragPast(page: Page, from: Locator, past: Locator): Promise<void> {
  const start = await centre(from);
  const end = await centre(past);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.right - 4, end.y, { steps: 16 });
  await page.mouse.up();
}

const rearranged = (list: readonly string[], indexes: readonly number[]) => indexes.map((index) => list[index]);

test("dragging a tab past two others moves it there, keeps the selection, and the order survives a reload", async ({
  page,
}) => {
  const before = await fourTabs(page);
  const selected = await selectedIndex(page);
  await dragPast(page, tabs(page).nth(0), tabs(page).nth(2));
  await expect(tabs(page).nth(selected)).toHaveAttribute("aria-selected", "true");
  const after = rearranged(before, [1, 2, 0, 3]);
  expect(await order(page)).toEqual(after);
  await page.keyboard.press("ControlOrMeta+3");
  expect(await focusedAddress(page)).toBe(before[0]);

  await page.reload();
  await expect(tabs(page)).toHaveCount(4, { timeout: 20_000 });
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  expect(await order(page)).toEqual(after);
});

test("a press that wobbles 2 px is a click that selects, and Escape puts a dragged tab back", async ({ page }) => {
  const before = await fourTabs(page);
  const first = await centre(tabs(page).nth(1));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(first.x + 2, first.y);
  await page.mouse.up();
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");

  const end = await centre(tabs(page).nth(3));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(strip(page).locator("[data-dragging]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await order(page)).toEqual(before);
});

test("the keyboard moves the focused tab, focus stays on it, and its new place is announced", async ({ page }) => {
  const before = await fourTabs(page);
  const mac = await page.evaluate(() => navigator.platform.startsWith("Mac"));
  await tabs(page).nth(0).focus();
  await page.keyboard.press(mac ? "Meta+Shift+ArrowRight" : "Control+Shift+PageDown");
  await expect(tabs(page).nth(1)).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: /^Moved .+ to position 2 of 4/ })).toHaveCount(1);
  await page.keyboard.press(mac ? "Meta+Shift+ArrowRight" : "Control+Shift+PageDown");
  await expect(tabs(page).nth(2)).toBeFocused();
  expect(await order(page)).toEqual(rearranged(before, [1, 2, 0, 3]));
});

test("a tab's menu moves it left or right, and an end of the strip disables the way out", async ({ page }) => {
  const before = await fourTabs(page);
  await tabs(page).nth(0).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Move tab left" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move tab right" }).click();
  await expect(tabs(page).nth(1)).toBeFocused();
  expect(await order(page)).toEqual(rearranged(before, [1, 0, 2, 3]));
  await tabs(page).nth(3).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Move tab right" })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("under reduced motion neighbours stay put and a caret marks where the tab lands", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fourTabs(page);
  const start = await centre(tabs(page).nth(0));
  const end = await centre(tabs(page).nth(2));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.right - 4, end.y, { steps: 12 });
  await expect(strip(page).locator("[data-tab-drop-caret]")).toBeVisible();
  const translates = await strip(page)
    .locator("[data-tab-id]:not([data-dragging])")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).translate));
  expect(translates.every((value) => value === "none")).toBe(true);
  await page.mouse.up();
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  /** A one-finger touch through CDP: held until the tab lifts when `hold` is set, then moved to `x`, then lifted. */
  async function touchDrag(page: Page, from: Locator, x: number, hold: boolean): Promise<void> {
    const start = await centre(from);
    const cdp = await page.context().newCDPSession(page);
    const at = (px: number) => [{ x: px, y: start.y }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start.x) });
    if (hold) await expect(strip(page).locator("[data-lifted]")).toHaveCount(1);
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(start.x + ((x - start.x) * step) / 12),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }

  test("a held touch drags a tab; a quick swipe does not move it", async ({ page }) => {
    const before = await fourTabs(page);
    await touchDrag(page, tabs(page).nth(0), (await centre(tabs(page).nth(2))).right - 4, false);
    expect(await order(page)).toEqual(before);
    await touchDrag(page, tabs(page).nth(0), (await centre(tabs(page).nth(2))).right - 4, true);
    expect(await order(page)).toEqual(rearranged(before, [1, 2, 0, 3]));
  });
});
