import type { Page } from "@playwright/test";
import { agentRow } from "./agents.ts";
import { type AskingAgent, startAskingAgent } from "./approval-agent.ts";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

let agent: AskingAgent;
let name: string;
let started = false;

/** Starts this test's asking agent; every test ends it, started or not by then. */
function ask(): void {
  name = `asks-${crypto.randomUUID().slice(0, 8)}`;
  agent = startAskingAgent(name);
  started = true;
}

test.afterEach(() => {
  if (started) agent.end();
  started = false;
});

const banner = (page: Page) => page.locator(`[data-approval="${agent.address}"]`);

/** Opens the asking agent's pane and waits for its banner to offer Allow and Deny. */
async function openAsking(page: Page): Promise<void> {
  await expect(agentRow(page, name, false)).toBeVisible({ timeout: 20_000 });
  await agentRow(page, name, false).click();
  await expect(banner(page)).toContainText("Claude Code", { timeout: 15_000 });
  await expect(banner(page)).toContainText("touch probe-a.txt");
  await expect(banner(page).getByRole("button", { name: /^Allow/ })).toBeEnabled();
}

test("Allow presses the agent's own key once, and the banner says it was answered from here", async ({ page }) => {
  ask();
  await page.goto("/");
  await openAsking(page);
  await banner(page)
    .getByRole("button", { name: /^Allow/ })
    .click();
  await expect(banner(page)).toContainText("Allowed", { timeout: 10_000 });
  await expect(banner(page)).toContainText("from this device");
  await expect.poll(agent.keys, { timeout: 10_000 }).toEqual(["1"]);
  await expect(page.locator(`[data-terminal="${agent.address}"]`)).toContainText("Allowed", { timeout: 10_000 });
  const [record] = agent.records();
  expect(record).toMatchObject({ answer: "allow", outcome: "sent", by: expect.stringContaining("Chrome") });
  await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
});

test("Deny presses Esc, for an agent that starts asking while the page is open", async ({ page }) => {
  // Known only from events, this terminal has no status_ms on the page (hc's status event carries none).
  await page.goto("/");
  await expect(page.getByRole("contentinfo")).toContainText(/\d+ terminals?/, { timeout: 20_000 });
  ask();
  await openAsking(page);
  await banner(page).getByRole("button", { name: /^Deny/ }).click();
  await expect(banner(page)).toContainText("Denied", { timeout: 10_000 });
  await expect.poll(agent.keys, { timeout: 10_000 }).toEqual(["\u001B"]);
  expect(agent.records()).toMatchObject([{ answer: "deny", outcome: "sent" }]);
});

test("stale: answered in the terminal before the status caught up, so the banner sends nothing", async ({ page }) => {
  ask();
  await page.goto("/");
  await openAsking(page);
  agent.typeInTerminal("x");
  await expect.poll(agent.keys, { timeout: 10_000 }).toEqual(["x"]);
  await expect(page.locator(`[data-terminal="${agent.address}"]`)).toContainText("Answered in the terminal", {
    timeout: 10_000,
  });
  // The status still says blocked, so the banner still offers Allow; the re-read before the key press finds no prompt.
  await banner(page)
    .getByRole("button", { name: /^Allow/ })
    .click();
  await expect(banner(page)).toContainText("The prompt went away.", { timeout: 10_000 });
  expect(agent.keys()).toEqual(["x"]);
  expect(agent.records()).toMatchObject([{ answer: "allow", outcome: "stale" }]);
  await banner(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(banner(page)).toHaveCount(0);
});

test("two clients racing on one prompt: exactly one answer reaches the agent, the other says where it was answered", async ({
  page,
}) => {
  ask();
  const slow = page;
  const slowLink = await routeHcSocket(slow);
  await slow.goto("/");
  await openAsking(slow);
  const fast = await page.context().newPage();
  await fast.goto("/");
  await openAsking(fast);

  // Both press Allow while the prompt is up; the slow client's claim is held on its way to the core, so the fast one
  // claims first, re-reads the screen and presses the key. Then the slow claim reaches the core and finds it taken.
  const release = slowLink.hold("doc.set");
  await banner(slow)
    .getByRole("button", { name: /^Allow/ })
    .click();
  await expect(banner(slow)).toContainText("Checking the prompt is still on screen");
  await banner(fast)
    .getByRole("button", { name: /^Allow/ })
    .click();
  await expect(banner(fast)).toContainText("from this device", { timeout: 10_000 });
  release();
  await expect(banner(slow)).toContainText("Answered on another device (", { timeout: 10_000 });

  await expect.poll(agent.keys, { timeout: 10_000 }).toEqual(["1"]);
  expect(agent.records()).toHaveLength(1);
  await fast.close();
});
