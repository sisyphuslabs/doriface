import { devices, type Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];

/** What the screen says about the connection, wherever it says it. */
const notice = (page: Page, text: RegExp) => page.getByRole("status").filter({ hasText: text });
const OFFLINE = /Offline/;
const RECONNECTING = /Reconnecting/;

async function echoes(page: Page, marker: string): Promise<void> {
  const terminal = page.locator("[data-terminal]").filter({ visible: true }).first();
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`echo ${marker}-$((2+3))`);
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(`${marker}-5`, { timeout: 20_000 });
}

test.describe("desktop", () => {
  test("going offline is said in the status bar at once, and the notice leaves when the network is back", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await openNewTerminal(page);
    await context.setOffline(true);
    await expect(page.getByRole("contentinfo").getByRole("status").filter({ hasText: OFFLINE })).toBeVisible({
      timeout: 2_000,
    });
    await context.setOffline(false);
    await expect(notice(page, OFFLINE)).toHaveCount(0, { timeout: 2_000 });
    await echoes(page, "back-online");
  });

  test("a link that goes silent past the heartbeat budget is closed and reconnected", async ({ page }) => {
    // Three missed core heartbeats (15 s apart) are the budget; the wait is the behaviour under test.
    test.setTimeout(150_000);
    const socket = await routeHcSocket(page);
    await page.goto("/");
    await openNewTerminal(page);
    const opened = socket.opened();
    // No reset, no close: every frame from the host stops, as when Wi-Fi goes away under an open socket.
    const release = socket.holdFromHost("");
    await expect(notice(page, RECONNECTING)).toBeVisible({ timeout: 60_000 });
    release();
    await expect.poll(socket.opened, { timeout: 20_000 }).toBeGreaterThan(opened);
    await expect(notice(page, RECONNECTING)).toHaveCount(0, { timeout: 20_000 });
    await echoes(page, "after-silence");
  });
});

test.describe("phone", () => {
  test.use({ ...phone });

  async function openPhoneTerminal(page: Page): Promise<void> {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("banner").getByRole("button", { name: "New tab" }).click();
    await expect(page.locator("[data-terminal]")).toContainText("$", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Back to agents" })).toBeVisible();
  }

  test("the phone terminal screen says it is offline, and clears when the network is back", async ({
    page,
    context,
  }) => {
    await openPhoneTerminal(page);
    await context.setOffline(true);
    await expect(notice(page, OFFLINE)).toBeVisible({ timeout: 2_000 });
    await context.setOffline(false);
    await expect(notice(page, OFFLINE)).toHaveCount(0, { timeout: 2_000 });
  });

  test("the phone terminal screen says it is reconnecting while the host link is down", async ({ page }) => {
    const socket = await routeHcSocket(page);
    await openPhoneTerminal(page);
    await socket.drop(true);
    await expect(notice(page, RECONNECTING)).toBeVisible({ timeout: 5_000 });
    // The terminal stays on screen under the notice.
    await expect(page.locator("[data-terminal]")).toBeVisible();
    socket.restore();
    await expect(notice(page, RECONNECTING)).toHaveCount(0, { timeout: 20_000 });
    await echoes(page, "phone-back");
  });
});
