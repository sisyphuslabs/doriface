import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("font-size and cursor-style apply to an open terminal", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const fontSize = () => terminal.evaluate((el) => getComputedStyle(el).getPropertyValue("--term-font-size").trim());
  expect(await fontSize()).toBe("13pt");

  await page.goto("/settings");
  await page
    .getByRole("tab", { name: "Terminal" })
    .or(page.getByRole("button", { name: "Terminal" }))
    .first()
    .click();
  await page.getByRole("button", { name: "Increase font-size" }).click();
  await page.getByRole("button", { name: "Increase font-size" }).click();
  await page
    .getByRole("radio", { name: "bar" })
    .or(page.getByRole("button", { name: "bar" }))
    .first()
    .click();

  await page.getByRole("link", { name: "Back to workspace" }).first().click();
  await expect(page.locator('[data-focused="true"] [data-terminal]')).toContainText("$", { timeout: 20_000 });
  expect(await fontSize()).toBe("14pt");
  await expect(page.locator('[data-focused="true"] [data-terminal] [data-cursor-shape]')).toHaveAttribute(
    "data-cursor-shape",
    "bar",
    {
      timeout: 10_000,
    },
  );
});
