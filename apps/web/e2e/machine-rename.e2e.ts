import type { Page } from "@playwright/test";
import { agentRow, endAgent, startShell } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, STATE_BOUND_MS } from "./machine-switch.ts";

const RENAMED = "build-renamed";

/** A WebSocket message as text: JSON-RPC sits in it as plain UTF-8 after each frame header. */
const text = (message: string | Buffer): string => (typeof message === "string" ? message : message.toString("latin1"));

/**
 * Holds the core's answer to the page's first read of the added machine's layout until `release`, so a terminal opened
 * meanwhile finds that layout still loading and gets a tab of this screen's own (#459).
 */
async function holdMachineLayout(page: Page): Promise<{ readonly release: () => void }> {
  const held: (() => void)[] = [];
  let holding = true;
  let asked: RegExp | undefined;
  await page.routeWebSocket(/\/v1\/hc/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const sent = text(message);
      const id = /"id":(\d+),"method":"doc\.get"/.exec(sent)?.[1];
      if (holding && asked === undefined && id !== undefined && sent.includes(`"on":"${MACHINE_NAME}"`))
        asked = new RegExp(`"id":${id}[,}]`);
      server.send(message);
    });
    server.onMessage((message) => {
      if (holding && asked?.test(text(message)) === true) held.push(() => ws.send(message));
      else ws.send(message);
    });
  });
  return {
    release: () => {
      holding = false;
      for (const send of held.splice(0)) send();
    },
  };
}

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

  test("keeps a tab opened while the machine's layout was still loading, now at the new address", async ({ page }) => {
    const layout = await holdMachineLayout(page);
    await page.goto("/");
    await agentRow(page, "home", false).click();
    await agentRow(page, "e2e", true).click();
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    await expect(tabs.filter({ hasText: "e2e" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
    await expect(page.locator(`[data-terminal="${MACHINE_NAME}/${remote}"]`)).toBeVisible({ timeout: 15_000 });
    layout.release();
    const open = await tabs.count();

    hcOn("host", ["machine", "rename", MACHINE_NAME, RENAMED]);
    renamed = true;
    const moved = page.locator(`[data-terminal="${RENAMED}/${remote}"]`);
    await expect(moved).toBeVisible({ timeout: STATE_BOUND_MS });
    await expect(tabs).toHaveCount(open);
    await moved.click();
    await page.keyboard.type("echo renamed-$((40 + 2))\r");
    await expect(moved).toContainText("renamed-42", { timeout: 15_000 });
  });

  test("on a phone, stays in the open terminal, now at the new address, and it still answers", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await agentRow(page, "e2e", true).click();
    await expect(page.locator(`[data-terminal="${MACHINE_NAME}/${remote}"]`)).toContainText("$", { timeout: 15_000 });

    hcOn("host", ["machine", "rename", MACHINE_NAME, RENAMED]);
    renamed = true;
    const moved = page.locator(`[data-terminal="${RENAMED}/${remote}"]`);
    await expect(moved).toBeVisible({ timeout: STATE_BOUND_MS });
    await expect(page.getByRole("button", { name: "Back to agents" })).toBeVisible();
    await moved.click();
    await page.keyboard.type("echo renamed-$((40 + 2))\r");
    await expect(moved).toContainText("renamed-42", { timeout: 15_000 });
  });
});
