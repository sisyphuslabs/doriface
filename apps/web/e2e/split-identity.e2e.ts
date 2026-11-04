import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

/** The value a CSS variable resolves to as a colour, so it compares with a computed border colour. */
const colourOf = (page: Page, variable: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, variable);

const edgeOf = (pane: Locator) => pane.evaluate((el) => getComputedStyle(el).borderTopColor);

test("with no pane title bar, a split marks the focused pane's edge and the other shown pane's tab", async ({
  page,
}) => {
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  await page.getByRole("button", { name: "Split" }).click();
  const focused = page.locator('section[data-focused="true"]');
  const other = page.locator('section[data-split="true"][data-focused="false"]:visible');
  await expect(other).toHaveCount(1);

  await expect.poll(() => edgeOf(focused)).toBe(await colourOf(page, "--input"));
  await expect.poll(() => edgeOf(other)).toBe(await colourOf(page, "--border"));

  const otherName = (await other.getAttribute("aria-label"))?.replace(/ terminal$/, "") ?? "";
  const otherTab = page.getByRole("tab", { name: otherName, exact: false }).and(page.locator("[data-shown=true]"));
  await expect(otherTab).toHaveCount(1);
  await expect(otherTab).toHaveAttribute("aria-selected", "false");
});
