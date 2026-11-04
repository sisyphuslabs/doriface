import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { rows } from "./sidebar-measure.ts";

test.use({ serviceWorkers: "block" });

const focusIsIn = (page: Page, selector: string) =>
  page.evaluate((within) => document.activeElement?.closest(within) !== null, selector);

/** The address of the terminal whose input holds DOM focus. */
const focusedTerminal = (page: Page) =>
  page.evaluate(() =>
    document.activeElement instanceof HTMLTextAreaElement
      ? (document.activeElement.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null)
      : null,
  );

test("each sidebar list is one Tab stop and the arrow keys move within it", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  const idle = sidebar.getByRole("region", { name: "Idle" });
  await expect(rows(idle).nth(1)).toBeVisible({ timeout: 15_000 });
  const stops = await sidebar.evaluate((aside) =>
    [...aside.querySelectorAll("section")].map(
      (section) =>
        [...section.querySelectorAll(":scope > button, :scope > div > button")].filter(
          (button) => button instanceof HTMLButtonElement && !button.disabled && button.tabIndex >= 0,
        ).length,
    ),
  );
  expect(stops.length).toBeGreaterThanOrEqual(3);
  expect(stops.every((count) => count <= 1)).toBe(true);

  await rows(idle).first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows(idle).nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows(idle).first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows(idle).last()).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await idle.evaluate((region) => region.contains(document.activeElement))).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await expect(rows(idle).last()).toBeFocused();
});

test("the skip links are the first Tab stops, and Skip to terminal puts focus in the terminal", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await page.getByRole("button", { name: "Command palette" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Skip to sidebar" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const skip = page.getByRole("link", { name: "Skip to terminal" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  expect(await skip.evaluate((link) => getComputedStyle(link).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect.poll(() => focusedTerminal(page)).toBe(await terminal.getAttribute("data-terminal"));
  expect(await focusIsIn(page, 'aside[aria-label="Workspace"]')).toBe(false);
});
