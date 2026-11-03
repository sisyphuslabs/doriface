import { expect, test } from "./fixtures.ts";

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

  await page.goto("/");
  await expect(
    page
      .getByRole("button", { name: "New tab" })
      .or(page.getByRole("button", { name: "New terminal" }))
      .first(),
  ).toBeVisible({ timeout: 20_000 });
  const tabs = page.getByRole("tab");
  const before = await tabs.count();
  await page.keyboard.press("Control+Alt+N");
  await expect(tabs).toHaveCount(before + 1, { timeout: 15_000 });
});
