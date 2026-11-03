import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block" });

test("the arrow keys, Home and End stay inside the focused list", async ({ page }) => {
  await page.goto("/");
  await openNewTerminal(page);
  await openNewTerminal(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace" });
  const spaces = sidebar.getByRole("region", { name: "Spaces" }).getByRole("button");
  const idle = sidebar.getByRole("region", { name: "Idle" }).getByRole("button");
  await expect(idle.nth(1)).toBeVisible({ timeout: 15_000 });
  await spaces.last().focus();
  await page.keyboard.press("ArrowDown");
  await expect(spaces.last()).toBeFocused();
  await idle.first().focus();
  await page.keyboard.press("ArrowUp");
  await expect(idle.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(idle.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(idle.first()).toBeFocused();
  const machines = sidebar.getByRole("region", { name: "Machines" });
  const studio = machines.locator(":scope > div > button").first();
  await studio.focus();
  await page.keyboard.press("ArrowRight");
  await expect(machines.getByRole("button", { name: /^New terminal on / }).first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(studio).toBeFocused();
});
