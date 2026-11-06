import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/**
 * apps/desktop/src/config/window.ts TITLEBAR_CONTROLS, the controls its titlebar sheets keep clickable.
 */
const CONTROLS = 'a, button, input, select, textarea, [role="tab"], [role="button"], [tabindex], [data-tab-id]';

/**
 * The sheets the macOS app inserts (MAC_TITLEBAR_CSS, and the two variables MAC_INSET_CSS sets), applied here on every
 * platform so the rule Electron applies to them is the one this spec checks.
 */
const SHEETS = [
  `html::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 14px; -webkit-app-region: drag; z-index: 2147483647; }`,
  "[data-titlebar] { -webkit-app-region: drag; }",
  `[data-titlebar] :is(${CONTROLS}) { -webkit-app-region: no-drag; }`,
  ":root { --titlebar-inset-start: 78px; --sidebar-rail-width: 76px; }",
].join("\n");

/**
 * What a pointing device at this point starts: Blink lists every -webkit-app-region box in document order and Electron
 * lets the last of them covering the point win, so `drag` here is a click the window takes instead of the page.
 */
async function regionAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    (point) => {
      let last = "none";
      for (const element of document.querySelectorAll("*")) {
        const region = getComputedStyle(element).getPropertyValue("-webkit-app-region").trim();
        if (region !== "drag" && region !== "no-drag") continue;
        for (const box of element.getClientRects()) {
          if (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) last = region;
        }
      }
      return last;
    },
    { x, y },
  );
}

async function toggleCentre(page: Page): Promise<{ x: number; y: number }> {
  const toggle = page.getByRole("button", { name: /^(Hide|Show) sidebar$/ });
  const box = await toggle.boundingBox();
  if (box === null) throw new Error("the sidebar toggle has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A point on the tab strip's empty stretch, right of any tab, and a point in the gap beside the toggle. */
const EMPTY_STRETCH = { x: 700, y: 20 };
const BESIDE_THE_TOGGLE = { x: 110, y: 20 };

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Workspace" });

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(sidebar(page)).toBeVisible({ timeout: 20_000 });
  await page.addStyleTag({ content: SHEETS });
});

test("the toggle takes a click with the sidebar open, hidden and a rail, and the strip still drags the window", async ({
  page,
}) => {
  const open = await toggleCentre(page);
  expect(await regionAt(page, open.x, open.y), "the toggle, sidebar open").toBe("no-drag");
  expect(await regionAt(page, EMPTY_STRETCH.x, EMPTY_STRETCH.y), "the strip, sidebar open").toBe("drag");

  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar(page)).toBeHidden();
  const hidden = await toggleCentre(page);
  expect(await regionAt(page, hidden.x, hidden.y), "the toggle, sidebar hidden").toBe("no-drag");
  expect(await regionAt(page, EMPTY_STRETCH.x, EMPTY_STRETCH.y), "the strip, sidebar hidden").toBe("drag");
  expect(await regionAt(page, BESIDE_THE_TOGGLE.x, BESIDE_THE_TOGGLE.y), "beside the toggle").toBe("drag");

  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(sidebar(page)).toBeVisible();

  const separator = page.getByRole("separator", { name: "Resize sidebar" });
  await separator.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar(page)).toHaveAttribute("data-rail", "true");
  const rail = await toggleCentre(page);
  expect(await regionAt(page, rail.x, rail.y), "the toggle, sidebar a rail").toBe("no-drag");
  expect(await regionAt(page, EMPTY_STRETCH.x, EMPTY_STRETCH.y), "the strip, sidebar a rail").toBe("drag");
});

test("a click on the toggle brings the sidebar back by mouse alone", async ({ page }) => {
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar(page)).toBeHidden();
  const hidden = await toggleCentre(page);
  expect(
    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.closest("button")?.getAttribute("aria-label") ?? null;
    }, hidden),
    "the toggle is what a press at its centre lands on",
  ).toBe("Show sidebar");
});

test("the toggle keeps its tab order: skip links, the sidebar, the toggle, then the tabs", async ({ page }) => {
  const order = await page.evaluate(() => {
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    const toggle =
      document.querySelector('[aria-label="Hide sidebar"]') ?? document.querySelector('[aria-label="Show sidebar"]');
    const tablist = document.querySelector('[role="tablist"][aria-label="Tabs"]');
    const skip = document.querySelector('a[href="#sidebar"]');
    const aside = document.querySelector('aside[aria-label="Workspace"]');
    const before = (first: Element | null, second: Element | null): boolean =>
      first !== null && second !== null && (first.compareDocumentPosition(second) & following) !== 0;
    return { skip: before(skip, aside), sidebar: before(aside, toggle), toggle: before(toggle, tablist) };
  });
  expect(order).toEqual({ skip: true, sidebar: true, toggle: true });
});
