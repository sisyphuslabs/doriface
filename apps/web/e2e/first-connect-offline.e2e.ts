import type { Page } from "@playwright/test";
import { E2E_HOST_PORT } from "./config.ts";
import { expect, test } from "./fixtures.ts";
import { LAN_HC_URL } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const OFFLINE_NOTICE = /You are offline/;

const osOfflineFromStart = (page: Page) =>
  page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false }),
  );

const gatewayDown = (page: Page, url: string) =>
  page.routeWebSocket(url, (socket) => void socket.close({ code: 1011, reason: "host unreachable" }));

async function firstConnectFails(page: Page, url: string): Promise<void> {
  await osOfflineFromStart(page);
  await gatewayDown(page, url);
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Cannot reach your host" })).toBeVisible({ timeout: 15_000 });
}

test.describe("the first-connect screen while the OS reports no network", () => {
  test("a link to this computer that fails is not blamed on the network", async ({ page }) => {
    await firstConnectFails(page, `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`);
    await expect(page.getByRole("status").filter({ hasText: OFFLINE_NOTICE })).toHaveCount(0);
  });

  test.describe("a host across the network", () => {
    test.use({ loopbackUrl: LAN_HC_URL });

    test("a failed first connect also says the device is offline", async ({ page }) => {
      await firstConnectFails(page, LAN_HC_URL);
      await expect(page.getByRole("status").filter({ hasText: OFFLINE_NOTICE })).toBeVisible();
    });
  });
});

test("with nothing configured yet, the first-run screen keeps its next steps and says the device is offline", async ({
  page,
}) => {
  // No host chosen: the fixture's loopback settings are removed again before the app reads them.
  await page.addInitScript(() => localStorage.removeItem("doriface.connection"));
  await osOfflineFromStart(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to a host" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: OFFLINE_NOTICE })).toBeVisible();
  // Pairing needs a network, so it is not the enabled first step while offline.
  await expect(page.getByRole("link", { name: "Pair a host" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pair a host" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pair a host" })).toHaveAccessibleDescription(/needs a network/);
});

test("the pairing page says the device is offline, and a lookup that cannot reach the relay promises no QR scan", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("doriface.connection"));
  await osOfflineFromStart(page);
  await page.route(/\/v1\/pair\//, (route) => route.abort("internetdisconnected"));
  await page.goto("/pair");
  await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: OFFLINE_NOTICE })).toBeVisible();
  await page.getByRole("textbox", { name: "Pairing code" }).fill("ABCD2345");
  await page.getByRole("button", { name: "Pair" }).click();
  const reason = page.getByText(/relay cannot be reached/);
  await expect(reason).toBeVisible({ timeout: 15_000 });
  await expect(reason).not.toContainText(/scan/i);
});
