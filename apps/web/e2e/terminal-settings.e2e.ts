import { expect, test } from "./fixtures.ts";

test("font-size and cursor-style apply to an open terminal", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  const terminal = page.locator(".wterm").first();
  await expect(terminal).toContainText("$", { timeout: 20_000 });
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

  await page.goto("/");
  await expect(page.locator(".wterm").first()).toContainText("$", { timeout: 20_000 });
  expect(await fontSize()).toBe("14pt");
  await expect(page.locator("[data-cursor-shape]").first()).toHaveAttribute("data-cursor-shape", "bar", {
    timeout: 10_000,
  });
});
