import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Workspace" });
const region = (page: Page, name: string) => sidebar(page).getByRole("region", { name, exact: true });
const split = (page: Page) => sidebar(page).getByRole("separator", { name: "Resize Spaces and Agents" });
const edge = (page: Page) => sidebar(page).getByRole("separator", { name: "Resize sidebar" });
const pane = (page: Page, name: "spaces" | "agents") => sidebar(page).locator(`[data-sidebar-pane="${name}"]`);

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("not laid out");
  return found;
};
const height = async (locator: Locator) => Math.round((await box(locator)).height);
const width = async (locator: Locator) => Math.round((await box(locator)).width);

/** Drags `handle` by (dx, dy) from its centre with the mouse, in steps, like a person would. */
async function drag(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const at = await box(handle);
  const x = at.x + at.width / 2;
  const y = at.y + at.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(region(page, "Agents")).toBeVisible({ timeout: 20_000 });
  await expect(region(page, "Spaces")).toBeVisible({ timeout: 20_000 });
}

test("Agents sits below Spaces, docked to the sidebar's bottom edge above the footer (#383)", async ({ page }) => {
  await open(page);
  const spaces = await box(pane(page, "spaces"));
  const agents = await box(pane(page, "agents"));
  const footer = await box(sidebar(page).getByRole("link", { name: "Settings" }));
  expect(agents.y).toBeGreaterThanOrEqual(spaces.y + spaces.height - 1);
  // Docked: the Agents pane ends where the footer begins, whatever the lists hold.
  expect(Math.abs(agents.y + agents.height - footer.y)).toBeLessThanOrEqual(12);
  // And the reading and Tab order follow: Spaces comes first in the document.
  const spacesFirst = await region(page, "Spaces").evaluate(
    (spacesNode, agentsNode) => {
      return agentsNode instanceof Node && (spacesNode.compareDocumentPosition(agentsNode) & 4) !== 0;
    },
    await region(page, "Agents").elementHandle(),
  );
  expect(spacesFirst).toBe(true);
});

test("dragging the Spaces/Agents divider shares the height, clamped, and the size survives a reload (#384)", async ({
  page,
}) => {
  await open(page);
  const before = await height(pane(page, "agents"));
  await drag(page, split(page), 0, -80);
  await expect.poll(() => height(pane(page, "agents"))).toBeGreaterThanOrEqual(before + 76);
  const dragged = await height(pane(page, "agents"));
  // Far up and far down stop at each section's minimum height.
  await drag(page, split(page), 0, -2000);
  await expect.poll(() => height(pane(page, "spaces"))).toBeGreaterThanOrEqual(96);
  await drag(page, split(page), 0, 4000);
  await expect.poll(() => height(pane(page, "agents"))).toBeGreaterThanOrEqual(96);
  expect(await height(pane(page, "agents"))).toBeLessThan(before);
  await drag(page, split(page), 0, -(before - (await height(pane(page, "agents")))) - 80);
  await expect.poll(() => height(pane(page, "agents"))).toBeGreaterThanOrEqual(dragged - 4);
  const kept = await height(pane(page, "agents"));
  await page.reload();
  await expect(region(page, "Agents")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => height(pane(page, "agents"))).toBe(kept);
});

test("the divider is a focusable separator the keyboard moves, with Home and End at the clamps (#384)", async ({
  page,
}) => {
  await open(page);
  const handle = split(page);
  await expect(handle).toHaveAttribute("aria-orientation", "horizontal");
  const now = async () => Number(await handle.getAttribute("aria-valuenow"));
  const start = await now();
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(now).toBeGreaterThan(start);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(now).toBeLessThan(start);
  await page.keyboard.press("Home");
  await expect.poll(now).toBe(Number(await handle.getAttribute("aria-valuemin")));
  await page.keyboard.press("End");
  await expect.poll(now).toBe(Number(await handle.getAttribute("aria-valuemax")));
  await expect.poll(() => height(pane(page, "spaces"))).toBeGreaterThanOrEqual(96);
});

test("double-clicking the divider or the sidebar edge resets each to its default (#384)", async ({ page }) => {
  await open(page);
  const agents = await height(pane(page, "agents"));
  const aside = await width(sidebar(page));
  await drag(page, split(page), 0, -120);
  await drag(page, edge(page), 100, 0);
  await expect.poll(() => width(sidebar(page))).toBeGreaterThan(aside + 60);
  await expect.poll(() => height(pane(page, "agents"))).toBeGreaterThan(agents + 60);
  await split(page).dblclick();
  await expect.poll(() => height(pane(page, "agents"))).toBe(agents);
  await edge(page).dblclick();
  await expect.poll(() => width(sidebar(page))).toBe(aside);
  await page.reload();
  await expect(region(page, "Agents")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => width(sidebar(page))).toBe(aside);
  await expect.poll(() => height(pane(page, "agents"))).toBe(agents);
});

test("dragging the sidebar edge changes its width up to the maximum, and the width survives a reload (#384)", async ({
  page,
}) => {
  await open(page);
  await drag(page, edge(page), 1000, 0);
  await expect.poll(() => width(sidebar(page))).toBe(480);
  await expect(edge(page)).toHaveAttribute("aria-valuenow", "480");
  await drag(page, edge(page), -180, 0);
  await expect.poll(() => width(sidebar(page))).toBeLessThan(310);
  const dragged = await width(sidebar(page));
  expect(dragged).toBeGreaterThan(290);
  await page.reload();
  await expect(region(page, "Agents")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => width(sidebar(page))).toBe(dragged);
});
