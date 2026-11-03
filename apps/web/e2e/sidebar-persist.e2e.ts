import { expect, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

test("the sidebar stays hidden or shown across a reload", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  await expect(sidebar).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible({ timeout: 20_000 });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.reload();
  await expect(sidebar).toBeVisible({ timeout: 20_000 });
});
