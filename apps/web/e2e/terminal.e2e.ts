import { expect, openNewTerminal, test } from "./fixtures.ts";

test("a live terminal echoes what you type", async ({ page }, info) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("echo doriface-ok");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(/doriface-ok[\s\S]*doriface-ok/, { timeout: 15_000 });
  await page.screenshot({ path: info.outputPath("terminal.png") });
});
