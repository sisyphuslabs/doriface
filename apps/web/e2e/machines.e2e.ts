import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";

const machineRow = (page: Page) => page.getByRole("button", { name: new RegExp(`^${MACHINE_NAME}\\b`) });
const newOn = (page: Page) => page.getByRole("button", { name: `New terminal on ${MACHINE_NAME}` });

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
  });
});
