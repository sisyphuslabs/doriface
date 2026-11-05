import type { Page } from "@playwright/test";
import { agentRow, crashProgram, endAgent, startKeptShell, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";

/** The selected tab shows the terminal: a tab reads its number, as herdr-app's, so it is found by what it shows. */
const inSelectedTab = (page: Page, address: string) =>
  page.locator(`[role="tabpanel"]:not([hidden]) [data-terminal="${address}"]`);

test.describe("a kept program on another machine that crashes and hc revives", () => {
  let local = "";
  let kept = "";
  test.beforeEach(() => {
    local = startShell("host", "home");
    kept = startKeptShell("machine", "keeper");
  });
  test.afterEach(() => {
    endAgent("machine", kept);
    endAgent("host", local);
  });

  test("keeps its tab and the revived shell answers in it", async ({ page }) => {
    await page.goto("/");
    await agentRow(page, "home", false).click();
    await agentRow(page, "keeper", true).click();
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    await expect(inSelectedTab(page, `${MACHINE_NAME}/${kept}`)).toHaveCount(1, { timeout: 20_000 });
    const open = await tabs.count();
    const terminal = page.locator(`[data-terminal="${MACHINE_NAME}/${kept}"]`);
    await expect(terminal).toContainText("$", { timeout: 15_000 });

    await terminal.evaluate((element) => element.setAttribute("data-before-crash", ""));
    crashProgram("machine", kept);
    // hc restarts the shell about 2 s after the loss; the pane mounts a fresh view for the new program.
    const revived = page.locator(`[data-terminal="${MACHINE_NAME}/${kept}"]:not([data-before-crash])`);
    await expect(revived).toBeVisible({ timeout: 20_000 });
    await expect(tabs).toHaveCount(open);
    await revived.click();
    await page.keyboard.type("echo revived-$((40 + 2))\r");
    await expect(revived).toContainText("revived-42", { timeout: 20_000 });
    await expect(inSelectedTab(page, `${MACHINE_NAME}/${kept}`)).toHaveCount(1);
  });

  test("on a phone, stays in the terminal and the revived shell answers", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await agentRow(page, "keeper", true).click();
    const terminal = page.locator(`[data-terminal="${MACHINE_NAME}/${kept}"]`);
    await expect(terminal).toContainText("$", { timeout: 15_000 });

    await terminal.evaluate((element) => element.setAttribute("data-before-crash", ""));
    crashProgram("machine", kept);
    const revived = page.locator(`[data-terminal="${MACHINE_NAME}/${kept}"]:not([data-before-crash])`);
    await expect(revived).toBeVisible({ timeout: 20_000 });
    await revived.click();
    await page.keyboard.type("echo revived-$((40 + 2))\r");
    await expect(revived).toContainText("revived-42", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Back to agents" })).toBeVisible();
  });
});
