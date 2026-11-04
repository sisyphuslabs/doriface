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
