import { expect, terminalCount, test } from "./fixtures.ts";

test("rebinding New tab makes the new shortcut open a tab", async ({ page }) => {
  await page.goto("/settings");
  await page
    .getByRole("tab", { name: "Keybindings" })
    .or(page.getByRole("button", { name: "Keybindings" }))
    .first()
    .click();
  await page.getByRole("button", { name: "Record a shortcut for New tab" }).click();
  await expect(page.getByRole("status")).toHaveText("Press keys…");
  await page.keyboard.press("Control+Alt+N");
  await expect(page.getByText("Changed")).toBeVisible();

  await page.getByRole("link", { name: "Back to workspace" }).first().click();
  const count = await terminalCount(page);
  await page.keyboard.press("Control+Alt+N");
  await count.grown();
});
