import { agentRow, endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, STATE_BOUND_MS } from "./machine-switch.ts";

const RENAMED = "build-renamed";

test.describe("renaming a machine with its terminals open", () => {
  let local = "";
  let remote = "";
  let renamed = false;
  test.beforeEach(() => {
    local = startShell("host", "home");
    remote = startShell("machine", "e2e");
  });
  test.afterEach(() => {
    if (renamed) hcOn("host", ["machine", "rename", RENAMED, MACHINE_NAME]);
    renamed = false;
    endAgent("machine", remote);
    endAgent("host", local);
  });

  test("keeps its open tab beside this machine's, now at the new address, and the terminal still answers", async ({
    page,
  }) => {
    await page.goto("/");
    await agentRow(page, "home", false).click();
    await agentRow(page, "e2e", true).click();
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    await expect(tabs.filter({ hasText: "e2e" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
    await expect(tabs.filter({ hasText: "home" })).toHaveCount(1);
    await expect(page.locator(`[data-terminal="${MACHINE_NAME}/${remote}"]`)).toBeVisible({ timeout: 15_000 });
    const open = await tabs.count();

    hcOn("host", ["machine", "rename", MACHINE_NAME, RENAMED]);
    renamed = true;
    const moved = page.locator(`[data-terminal="${RENAMED}/${remote}"]`);
    await expect(moved).toBeVisible({ timeout: STATE_BOUND_MS });
    await expect(tabs).toHaveCount(open);
    await expect(tabs.filter({ hasText: "e2e" })).toHaveAttribute("aria-selected", "true");

    await moved.click();
    await page.keyboard.type("echo renamed-$((40 + 2))\r");
    await expect(moved).toContainText("renamed-42", { timeout: 15_000 });
  });
});
