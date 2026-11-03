import { expect, test } from "./fixtures.ts";

test("a live terminal echoes what you type", async ({ page }, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$", { timeout: 20_000 });
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("echo doriface-ok");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(/doriface-ok[\s\S]*doriface-ok/, { timeout: 15_000 });
  await page.screenshot({ path: info.outputPath("terminal.png") });
});
