import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

const tabBar = (page: Page) => page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
const renameDialog = (page: Page) => page.getByRole("dialog", { name: /^Rename / });

// Only the selected tab shows its close button, so selecting a tab moves the strip: the first click of a double-click on
// the tab after the selected one shifts it left and puts its own close button under the pointer, where the second click
// lands. That double-click must rename the tab, never close it.
test("a double-click on the tab after the selected one renames it and closes nothing", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 3; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one tab after another
    await openNewTerminal(page);
  }
  await tabBar(page).nth(0).click();
  await expect(tabBar(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(tabBar(page)).toHaveCount(3);

  await tabBar(page).nth(1).dblclick();
  await expect(renameDialog(page)).toBeVisible({ timeout: 5_000 });
  await renameDialog(page).getByRole("textbox").fill("renamed-by-double-click");
  await renameDialog(page).getByRole("textbox").press("Enter");
  await expect(renameDialog(page)).toBeHidden();
  await expect(tabBar(page)).toHaveCount(3);
  await expect(tabBar(page).nth(1)).toHaveText(/renamed-by-double-click/);
});
