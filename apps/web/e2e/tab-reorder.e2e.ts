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
  const select = async (index: number) => {
    await page.keyboard.press(`ControlOrMeta+${index + 1}`);
    await expect(tabs(page).nth(index)).toHaveAttribute("aria-selected", "true");
  };
  const addresses = await Array.from({ length: count }, (_unused, index) => index).reduce<Promise<string[]>>(
    async (previous, index) => {
      const listed = await previous;
      await select(index);
      return [...listed, (await focusedAddress(page)) ?? ""];
    },
    Promise.resolve([]),
  );
  await select(selected);
  return addresses;
}

/** Four tabs, the last of them new and selected: the workspace opens one on its own when the core has a live one. */
async function fourTabs(page: Page): Promise<string[]> {
  await page.goto("/");
  await openNewTerminal(page);
  const missing = 4 - (await tabs(page).count());
  await Array.from({ length: missing }).reduce<Promise<unknown>>(
    (previous) => previous.then(() => openNewTerminal(page)),
    Promise.resolve(),
  );
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

  // Drag a tab that is not the selected one: only those carry the hover wash.
  const other = await centre(tabs(page).nth(0));
  const end = await centre(tabs(page).nth(3));
  await page.mouse.move(other.x, other.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(strip(page).locator("[data-dragging]")).toHaveCount(1);
  // Hovered under the pointer, the lifted tab still hides the tab it passes over.
  const fill = await strip(page)
    .locator("[data-dragging]")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
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

/**
 * One finger through CDP, on a paused page clock so only the test decides when the hold has lasted: held
 * (`hold`, the clock runs past the lift) or not, then moved to `x` (or left in place), then lifted.
 */
async function touch(page: Page, from: Locator, x: number | null, hold: boolean): Promise<void> {
  const start = await centre(from);
  // A pause must lie ahead of the page clock, which keeps running while this call travels.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 5_000);
  const cdp = await page.context().newCDPSession(page);
  const at = (px: number) => [{ x: px, y: start.y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start.x) });
  if (hold) {
    await page.clock.runFor(TOUCH_LIFT_MS);
    await expect(strip(page).locator("[data-lifted]")).toHaveCount(1);
  }
  const target = x ?? start.x;
  await Array.from({ length: x === null ? 0 : 12 }, (_unused, index) => index + 1).reduce<Promise<unknown>>(
    (previous, step) =>
      previous.then(() =>
        cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: at(start.x + ((target - start.x) * step) / 12),
        }),
      ),
    Promise.resolve(),
  );
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.clock.resume();
}

/** Past the 300 ms hold that lifts a tab under a finger. */
const TOUCH_LIFT_MS = 350;

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("a held touch drags a tab, a quick swipe does not, and a hold let go opens the tab's menu", async ({ page }) => {
    await page.clock.install();
    const before = await fourTabs(page);
    const selected = await selectedIndex(page);
    const past = async () => (await centre(tabs(page).nth(2))).right - 4;
    await touch(page, tabs(page).nth(0), await past(), false);
    expect(await order(page)).toEqual(before);
    await touch(page, tabs(page).nth(0), await past(), true);
    const after = rearranged(before, [1, 2, 0, 3]);
    expect(await order(page)).toEqual(after);

    await touch(page, tabs(page).nth(0), null, true);
    await expect(page.getByRole("menuitem", { name: "Move tab right" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tabs(page).nth(selected)).toHaveAttribute("aria-selected", "true");
    expect(await order(page)).toEqual(after);
  });
});
