import type { Locator } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

const edgeOf = (pane: Locator) => pane.evaluate((el) => getComputedStyle(el).borderTopColor);

for (const scheme of ["light", "dark"] as const) {
  test(`with no pane title bar, a split marks the focused pane's edge and names the other shown tab (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await openNewTerminal(page);
    await openNewTerminal(page);
    const single = page.locator('section[data-focused="true"]');
    const unsplitEdge = await edgeOf(single);
    await page.getByRole("button", { name: "Split" }).click();
    const focused = page.locator('section[data-focused="true"]');
    const other = page.locator('section[data-split="true"][data-focused="false"]:visible');
    await expect(other).toHaveCount(1);

    // The focused pane's edge differs from the other shown pane's, which keeps the unsplit hairline.
    await expect.poll(() => edgeOf(other)).toBe(unsplitEdge);
    await expect.poll(async () => (await edgeOf(focused)) !== (await edgeOf(other))).toBe(true);

    const otherTitle = (await other.getAttribute("aria-label"))?.replace(/ terminal$/, "") ?? "";
    const shownTab = page.getByRole("tab", { name: /, shown in split$/ });
    await expect(shownTab).toHaveCount(1);
    await expect(shownTab).toHaveAttribute("aria-selected", "false");
    await expect.poll(async () => (await shownTab.getAttribute("title"))?.startsWith(otherTitle)).toBe(true);
  });
}
