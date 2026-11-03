import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { machineRow, newOn } from "./machine-switch.ts";

test.use({ serviceWorkers: "block" });

test("a machine with no terminals keeps New terminal on it reachable from the keyboard", async ({ page }) => {
  await page.goto("/");
  await expect(machineRow(page)).toContainText(/connected\s*0/, { timeout: 20_000 });
  const machines = page.getByRole("complementary", { name: "Workspace" }).getByRole("region", { name: "Machines" });
  // A terminal left open by earlier specs takes focus when its renderer attaches; let it, then move focus ourselves.
  const pane = page.locator('[data-focused="true"] [data-terminal]');
  if ((await pane.count()) > 0) await expect(pane).toContainText("$", { timeout: 15_000 });
  const studio = machines.locator(":scope > div > button").first();
  await studio.focus();
  await expect(studio).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(machineRow(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(newOn(page)).toBeFocused();
  await page.keyboard.press("Enter");
  const focused = page.locator('[data-focused="true"] [data-terminal]');
  await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${MACHINE_NAME}/t\\d+$`), { timeout: 15_000 });
  await expect(focused).toContainText("$", { timeout: 15_000 });
  await focused.click();
  await page.keyboard.type("exit\r");
  await expect(machineRow(page)).toContainText(/connected\s*0/, { timeout: 15_000 });
});
