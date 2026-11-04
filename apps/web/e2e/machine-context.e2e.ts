import { agentRow, endAgent, startAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";

const HOST_NAME = "studio";

test.describe("two terminals named alike on two machines", () => {
  const started: { core: "host" | "machine"; address: string }[] = [];
  test.beforeEach(() => {
    started.push({ core: "host", address: startAgent("host", "review", "idle") });
    started.push({ core: "machine", address: startAgent("machine", "review", "idle") });
  });
  test.afterEach(() => {
    for (const { core, address } of started.splice(0)) endAgent(core, address);
  });

  test("tabs and the status bar say which machine each one is on", async ({ page }) => {
    await page.goto("/");
    await agentRow(page, "review", false).click();
    await agentRow(page, "review", true).click();
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab", { name: /review/ });
    await expect(tabs).toHaveCount(2, { timeout: 15_000 });
    const remote = tabs.filter({ hasText: MACHINE_NAME });
    await expect(remote).toHaveCount(1);
    // The tooltip ends in the pane's shortcut while the tab is shown, e.g. "review on build-box (Ctrl+1)".
    await expect(remote).toHaveAttribute("title", new RegExp(`^review on ${MACHINE_NAME}( \\(.+\\))?$`));
    await expect(tabs.filter({ hasNotText: MACHINE_NAME })).toHaveAttribute("title", /^review( \(.+\))?$/);

    const status = page.getByRole("contentinfo");
    await expect(status).toContainText(MACHINE_NAME);
    await tabs.filter({ hasNotText: MACHINE_NAME }).click();
    await expect(status).toContainText(HOST_NAME);
    await expect(status).not.toContainText(MACHINE_NAME);
  });

  test("the phone's terminal header names the machine and the space", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await agentRow(page, "review", true).click();
    const header = page.locator("header").filter({ has: page.getByRole("button", { name: "Back to agents" }) });
    await expect(header).toContainText(`${MACHINE_NAME} · api`, { timeout: 15_000 });
  });
});
