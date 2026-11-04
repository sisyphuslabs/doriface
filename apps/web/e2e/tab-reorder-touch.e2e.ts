import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { centre, fourTabs, order, rearranged, selectedIndex, strip, tabs } from "./tab-strip.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

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
  // Every event carries the touch's own time (8 ms a step, the moves after the hold when held), so the browser's
  // gesture recognition sees the same finger whatever this machine's load makes the calls take.
  const t0 = Date.now() / 1000;
  const stamp = (ms: number) => t0 + ms / 1000;
  const movesFrom = hold ? TOUCH_LIFT_MS : 0;
  const steps = x === null ? 0 : 12;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start.x), timestamp: stamp(0) });
  if (hold) {
    await page.clock.runFor(TOUCH_LIFT_MS);
    await expect(strip(page).locator("[data-lifted]")).toHaveCount(1);
  }
  const target = x ?? start.x;
  await Array.from({ length: steps }, (_unused, index) => index + 1).reduce<Promise<unknown>>(
    (previous, step) =>
      previous.then(() =>
        cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: at(start.x + ((target - start.x) * step) / 12),
          timestamp: stamp(movesFrom + step * 8),
        }),
      ),
    Promise.resolve(),
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: stamp(movesFrom + (steps + 1) * 8),
  });
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
