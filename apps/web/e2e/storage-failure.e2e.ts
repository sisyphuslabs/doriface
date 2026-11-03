import { expect, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("with storage failing, settings say to reload and their controls are disabled", async ({ page }) => {
  await page.addInitScript({
    content: `IDBFactory.prototype.open = () => { throw new DOMException("IndexedDB is not available here", "InvalidStateError"); };`,
  });
  await page.goto("/settings");
  const go = (name: string) => page.getByRole("tab", { name }).or(page.getByRole("button", { name })).first().click();

  await go("Terminal");
  const terminalNotice = page.getByRole("alert").filter({ hasText: "Terminal settings could not be read" });
  await expect(terminalNotice).toContainText("Reload the page to try again");
  await expect(page.getByRole("button", { name: "Increase font-size" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Import Ghostty config…" })).toBeDisabled();

  await go("Keybindings");
  const keyNotice = page.getByRole("alert").filter({ hasText: "Keybindings could not be read" });
  await expect(keyNotice).toContainText("Reload the page to try again");
  await expect(page.getByRole("button", { name: "Record a shortcut for New tab" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Import keybinds…" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("keybindings-storage-failed.png") });
});
