import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// An iPhone in landscape: the notch on one side, the home indicator below. With viewport-fit=cover Safari draws the
// page under all of it and reports each edge through env(safe-area-inset-*) (#555).
const INSETS = { top: 0, right: 47, bottom: 21, left: 47 };
const SIZE = { width: 844, height: 390 };

async function landscapeWithInsets(page: Page): Promise<void> {
  await page.setViewportSize(SIZE);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: INSETS });
}

/** What the page reads from env(safe-area-inset-*), so the test fails loudly if the override never reached it. */
async function envInsets(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const insets = {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    };
    probe.remove();
    return insets;
  });
}

/** Every visible control or label whose box reaches into a side or bottom inset, as "name: left..right / bottom". */
async function intoInsets(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ insets, size }) => {
      const selector = 'button, a[href], input, [role="tab"], [role="button"], h1, h2, [data-titlebar]';
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          // A visually hidden element (sr-only: clipped to nothing) draws nothing until it is focused.
          const clipped = style.clipPath === "inset(50%)" || style.clip === "rect(0px, 0px, 0px, 0px)";
          if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || clipped) return false;
          if (box.right <= 0 || box.left >= size.width || box.bottom <= 0 || box.top >= size.height) return false;
          return (
            box.left < insets.left - 0.5 ||
            box.right > size.width - insets.right + 0.5 ||
            box.bottom > size.height - insets.bottom + 0.5
          );
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          const name = (element.getAttribute("aria-label") ?? element.textContent ?? element.tagName)
            .trim()
            .slice(0, 30);
          return `${name}: ${Math.round(box.left)}..${Math.round(box.right)} / ${Math.round(box.bottom)}`;
        });
    },
    { insets: INSETS, size: SIZE },
  );
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`a landscape phone with a notch, ${colorScheme}`, () => {
    test.use({ colorScheme });

    test("the workspace keeps every control out of the side and bottom insets", async ({ page }) => {
      await landscapeWithInsets(page);
      await page.goto("/");
      await expect(page.locator("[data-titlebar]").first()).toBeVisible({ timeout: 20_000 });
      expect(await envInsets(page)).toEqual(INSETS);
      expect(await intoInsets(page)).toEqual([]);
      // The skip links draw only once focused: the first Tab stop must land clear of the notch too.
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to terminal" })).toBeFocused();
      expect(await intoInsets(page)).toEqual([]);
    });

    test("Settings keeps every control out of the side and bottom insets", async ({ page }) => {
      await landscapeWithInsets(page);
      await page.goto("/settings");
      await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible({ timeout: 20_000 });
      expect(await envInsets(page)).toEqual(INSETS);
      expect(await intoInsets(page)).toEqual([]);
    });
  });
}
