import type { Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const combobox = (page: Page) => page.getByRole("combobox", { name: "Command" });
const focusInDialog = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[role="dialog"][aria-label="Command palette"]') != null);

test("focus stays inside the open palette and returns to the terminal that opened it", async ({ page }) => {
  await page.goto("/");
  const opener = (await openNewTerminal(page)).getByRole("textbox");
  await opener.focus();
  await page.keyboard.press("ControlOrMeta+Shift+KeyP");
  await expect(combobox(page)).toBeFocused();

  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    // oxlint-disable-next-line no-await-in-loop -- each key moves focus on from where the last one left it
    const inside = await page.keyboard.press(key).then(() => focusInDialog(page));
    expect(inside, `focus after ${key}`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(opener).toBeFocused();
});
