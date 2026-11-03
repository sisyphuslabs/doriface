import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
test.use({ ...phone, serviceWorkers: "block" });

/** Opens the first row of the phone list and exits its shell; false when the list has no row left. */
async function exitFirst(page: Page): Promise<boolean> {
  const rows = page.locator("section > button");
  if ((await rows.count()) === 0) return false;
  await rows.first().click();
  const back = page.getByRole("button", { name: "Back to agents" });
  await expect(back).toBeVisible();
  const terminal = page.locator("[data-terminal]");
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  await terminal.click();
  // The echo's computed output proves keys reach the shell before exit is typed; a first key can land before that.
  await expect(async () => {
    await page.keyboard.type("echo ready-$((40 + 2))\r");
    await expect(terminal).toContainText("ready-42", { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.type("exit\r");
  await expect(back).toBeHidden({ timeout: 15_000 });
  return true;
}

test("with no terminals the phone says so and offers a new terminal and adding a machine", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
  for (let left = 40; left > 0; left -= 1) {
    // oxlint-disable-next-line no-await-in-loop -- each shell has to exit before the next row is read
    if (!(await exitFirst(page))) break;
  }
  const empty = page.getByRole("status").filter({ hasText: "No terminals yet" });
  await expect(empty).toBeVisible({ timeout: 15_000 });
  await expect(empty.getByRole("button", { name: "Add a machine" })).toBeVisible();
  await empty.getByRole("button", { name: "New terminal" }).click();
  await expect(page.getByRole("button", { name: "Back to agents" })).toBeVisible({ timeout: 15_000 });
});
