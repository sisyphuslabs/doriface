import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("off macOS the status bar shows the palette shortcut as Ctrl Shift P", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "Linux x86_64" });
    Object.defineProperty(Navigator.prototype, "userAgent", { get: () => "Mozilla/5.0 (X11; Linux x86_64)" });
  });
  await page.goto("/");
  await openNewTerminal(page);
  const hint = page
    .getByRole("contentinfo")
    .getByRole("button", { name: /Commands/ })
    .locator("kbd > span");
  await expect(hint).toHaveText(["Ctrl", "Shift", "P"]);
});
