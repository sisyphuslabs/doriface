import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

const transitionOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).transitionProperty);

const ARRIVING = ['aside[aria-label="Workspace"]', '[role="tablist"] > div'];

test("the sidebar and tabs ease in with transform and opacity once the first frame is painted", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await expect(page.locator(":root")).toHaveAttribute("data-ready", "");
  for (const property of await Promise.all(ARRIVING.map((selector) => transitionOf(page, selector)))) {
    expect(property).toContain("transform");
    expect(property).toContain("opacity");
  }
});

test("regions against the shell's clipping edge arrive without a transform, so no frame sits outside its box", async ({
  page,
}) => {
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  await page.getByRole("button", { name: "Split" }).click();
  const from = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--arrive-from").trim());
  expect(await from('aside[aria-label="Workspace"]')).toBe("none");
  expect(await from(".motion-arrive:has(> section[data-split='true'])")).toBe("none");
});

test("under reduced motion the same arrivals keep only the cross-fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await openNewTerminal(page);
  for (const property of await Promise.all(ARRIVING.map((selector) => transitionOf(page, selector)))) {
    expect(property).not.toContain("transform");
    expect(property).toContain("opacity");
  }
});
