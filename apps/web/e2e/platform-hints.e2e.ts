import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("off macOS the status bar and sidebar show the palette shortcut as Ctrl Shift P", async ({ page }) => {
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

  await page.getByRole("complementary", { name: "Workspace" }).getByRole("button", { name: "Command palette" }).hover();
  const tooltip = page.locator("[data-side]").filter({ hasText: "Command palette" }).locator("kbd > span");
  await expect(tooltip).toHaveText(["Ctrl", "Shift", "P"]);
});

test("off macOS the tab bar and pane headers show Ctrl shortcuts", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "Linux x86_64" });
    Object.defineProperty(Navigator.prototype, "userAgent", { get: () => "Mozilla/5.0 (X11; Linux x86_64)" });
  });
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await expect(page.locator('[data-focused="true"] header')).toContainText("Ctrl+1");
  await expect(page.locator('[data-focused="true"] header')).not.toContainText("⌘");
  await expect(terminal).toBeVisible();
  await page.getByRole("button", { name: "New tab" }).hover();
  const tooltip = page.locator("[data-side]").filter({ hasText: "New tab" }).locator("kbd > span");
  await expect(tooltip).toHaveText(["Ctrl", "Shift", "T"]);
});
