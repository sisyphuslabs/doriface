import type { Page } from "@playwright/test";
import { agentRow, endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { machineRow, reconnect, STATE_BOUND_MS, switchTo } from "./machine-switch.ts";

const statusCount = (page: Page) => page.getByRole("contentinfo").getByText(/^\d+ terminals?\b/);

test.describe("a machine whose line drops while its terminals keep running", () => {
  let address = "";
  test.beforeEach(() => {
    address = startAgent("machine", "crunch", "working");
  });
  test.afterEach(() => {
    reconnect();
    endAgent("machine", address);
  });

  test("its sessions stop reading live and Working, and leave the live counts", async ({ page }) => {
    await page.goto("/");
    const working = page.getByRole("region", { name: "Working" });
    await expect(agentRow(working, "crunch", true)).toBeVisible({ timeout: 20_000 });
    await expect(machineRow(page)).toContainText(/connected\s*1/);
    const before = Number.parseInt((await statusCount(page).textContent()) ?? "", 10);

    switchTo("drop");
    await expect(machineRow(page)).toContainText(/unreachable\s*0/, { timeout: STATE_BOUND_MS });
    await expect(working.getByRole("button", { name: /crunch/ })).toHaveCount(0);
    const row = agentRow(page.getByRole("region", { name: "Offline" }), "crunch", true);
    await expect(row.getByRole("img", { name: "Unknown" })).toBeVisible();
    await expect(statusCount(page)).toHaveText(new RegExp(`^${before - 1} terminals?\\b`));
  });
});
