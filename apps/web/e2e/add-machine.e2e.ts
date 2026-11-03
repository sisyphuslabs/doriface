import { expect, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

test("Add a machine in the sidebar shows the pairing steps in the app", async ({ page }) => {
  await page.goto("/");
  const machines = page.getByRole("complementary", { name: "Workspace" }).getByRole("region", { name: "Machines" });
  await machines.getByRole("button", { name: "Add a machine" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a machine" });
  await expect(dialog).toContainText("doriface-host pair");
  await expect(dialog).toContainText("doriface-host connect");
  await expect(dialog).toContainText("hc machine add --via 'doriface-host connect");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
