import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("a terminal that becomes ready under the open palette does not take its focus", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);

  // Hold the terminal core so the restored terminal is not ready until the palette is open.
  const gate = Promise.withResolvers<void>();
  await page.route("**/*.wasm", async (route) => {
    await gate.promise;
    await route.continue();
  });
  await page.reload();
  const combobox = page.getByRole("combobox", { name: "Command" });
  await page.getByRole("button", { name: "Command palette" }).first().click();
  await expect(combobox).toBeFocused();

  gate.resolve();
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$", { timeout: 15_000 });

  await page.keyboard.type("qqmarker");
  await expect(combobox).toBeFocused();
  await expect(combobox).toHaveValue("qqmarker");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await expect(terminal).not.toContainText("qqmarker");
});
