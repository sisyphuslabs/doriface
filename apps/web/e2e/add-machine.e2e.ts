import { expect, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

test("Add machine in the sidebar's footer shows the pairing steps in the app", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("complementary", { name: "Workspace" }).locator('[data-slot="sidebar-footer"]');
  await footer.getByRole("button", { name: "Add machine" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a machine" });
  await expect(dialog).toContainText("doriface-host pair");
  await expect(dialog).toContainText("doriface-host connect");
  await expect(dialog).toContainText("hc machine add --via 'doriface-host connect");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
