import { expect, test } from "./fixtures.ts";

test("a live terminal echoes what you type", async ({ page }, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  const terminal = page.locator("[data-terminal]").last();
  await expect(terminal).toBeVisible({ timeout: 20_000 });
  await terminal.click();
  await page.keyboard.type("echo doriface-ok");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(/doriface-ok[\s\S]*doriface-ok/, { timeout: 15_000 });
  await page.screenshot({ path: info.outputPath("terminal.png") });
});
