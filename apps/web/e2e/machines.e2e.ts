import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { machineRow, newOn, STATE_BOUND_MS, switchOn, switchTo } from "./machine-switch.ts";

test.describe("machines added with hc machine add", () => {
  test("New terminal on a machine starts its shell there and attaches it at machine/tN", async ({ page }) => {
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    await newOn(page).click({ force: true });
    const focused = page.locator('[data-focused="true"] [data-terminal]');
    await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${MACHINE_NAME}/t\\d+$`), { timeout: 15_000 });
    const address = await focused.getAttribute("data-terminal");
    await expect(page.locator('[data-focused="true"] header')).toContainText(address ?? "missing");
    await focused.click();
    await page.keyboard.type("echo on-build-box-$((40 + 2))\r");
    await expect(focused).toContainText("on-build-box-42", { timeout: 15_000 });
    await page.keyboard.type("exit\r");
    await expect(machineRow(page)).toContainText(/connected\s*0/, { timeout: 15_000 });
    await expect(machineRow(page)).toBeDisabled();
    await expect(machineRow(page).getByText(MACHINE_NAME, { exact: true })).toHaveCSS("opacity", "0.45");
  });

  test("a machine that goes offline with the page open reads unreachable and offers no new terminal", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    try {
      switchTo("off");
      await expect(machineRow(page)).toContainText("unreachable", { timeout: STATE_BOUND_MS });
      await expect(newOn(page)).toBeDisabled();
      expect(errors).toEqual([]);
    } finally {
      switchOn();
    }
  });

  test("a machine that asks for a login reads needs login in the attention tone", async ({ page }) => {
    await page.goto("/");
    await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
    try {
      switchTo("login");
      const state = machineRow(page).getByText("needs login", { exact: true });
      await expect(state).toBeVisible({ timeout: STATE_BOUND_MS });
      await expect(state).toHaveClass(/text-status-blocked-text/);
      await expect(state).toHaveCSS("opacity", "1");
      await expect(newOn(page)).toBeDisabled();
    } finally {
      switchOn();
    }
  });
});
