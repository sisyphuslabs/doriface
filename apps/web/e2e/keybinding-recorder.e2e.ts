import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const openKeybindings = async (page: Page) => {
  await page.goto("/settings");
  await page
    .getByRole("tab", { name: "Keybindings" })
    .or(page.getByRole("button", { name: "Keybindings" }))
    .first()
    .click();
};
const row = (page: Page, id: string) => page.locator(`[id="keybinding-${id}"]`).locator("xpath=../..");
const recordButton = (page: Page, label: string) =>
  page.getByRole("button", { name: `Record a shortcut for ${label}`, exact: true });
const recorder = (page: Page) => page.getByRole("status").filter({ hasText: "Press keys…" });

test("the recorder holds focus while it listens and hands it back to its row", async ({ page }) => {
  await openKeybindings(page);
  const record = recordButton(page, "New tab");
  await record.click();
  await expect(recorder(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(recorder(page)).toHaveCount(0);
  await expect(record).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(recorder(page)).toBeFocused();
  await page.keyboard.press("Control+Alt+N");
  await expect(row(page, "tab.new").getByText("Changed")).toBeVisible();
  await expect(record).toBeFocused();
});
