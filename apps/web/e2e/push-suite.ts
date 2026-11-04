// What every notifications spec shares: a test push service, a stubbed PushManager with the notification permission
// granted, and no subscription or agent left behind on either e2e host.
import type { Page } from "@playwright/test";
import { endAgent } from "./agents.ts";
import { E2E_LAYOUT_PORT } from "./config.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";
import { askHost, stubPushManager, TestPushService } from "./push.ts";

/** Registers the suite's hooks; call once at a spec file's top level. The getter is valid inside tests. */
export function pushSuite(): { readonly service: () => TestPushService; readonly later: (end: () => void) => void } {
  // One push service and one subscription on the shared e2e host: the specs run in order.
  test.describe.configure({ mode: "serial" });
  // The headless shell answers Notification.permission with "denied" whatever was granted; full Chromium honours it.
  test.use({ channel: "chromium" });
  let service: TestPushService | undefined;
  const ends: (() => void)[] = [];
  test.beforeAll(async () => {
    service = await TestPushService.start();
  });
  test.afterAll(async () => {
    for (const end of ends.splice(0)) end();
    await service?.close();
  });
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);
    if (service !== undefined) await stubPushManager(page, service);
    await page.addInitScript(() => {
      const ask = Notification.requestPermission.bind(Notification);
      Reflect.set(globalThis, "permissionAsks", 0);
      Notification.requestPermission = () => {
        Reflect.set(globalThis, "permissionAsks", Number(Reflect.get(globalThis, "permissionAsks")) + 1);
        return ask();
      };
    });
  });
  // Through the hosts, not the page: a test may have closed its page, and no subscription may outlive its test.
  test.afterEach(async () => {
    const endpoint = service?.endpoint ?? "";
    await askHost({ t: "unsubscribe", endpoint });
    await askHost({ t: "unsubscribe", endpoint }, E2E_LAYOUT_PORT);
  });
  return {
    service: () => {
      if (service === undefined) throw new Error("the push service did not start");
      return service;
    },
    later: (end) => void ends.push(end),
  };
}

/** Settings under the app's own service worker: the first visit installs it, the second runs under it. */
export async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Notifications" }).first().click();
}

export const pushState = (page: Page) => page.locator("[data-push-state]");

export async function turnOn(page: Page): Promise<void> {
  await openSettings(page);
  await expect(pushState(page)).toHaveAttribute("data-push-state", "off");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(pushState(page)).toHaveAttribute("data-push-state", "on");
}

const osc = (fields: string): string => `printf '\\033]7501;${fields}\\033\\\\'`;

/** An agent that works until it gets a line, then reports its turn done; returns its address. */
export function finishingAgent(name: string, later: (end: () => void) => void): string {
  const script = [osc("state=working:app=claude"), "read go", osc("state=done:app=claude"), "exec sleep 600"].join(
    "; ",
  );
  const out = hcOn("host", ["run", "--bg", "--name", name, "--label", "space=push", "--", "sh", "-c", script]);
  const address = String(Reflect.get(JSON.parse(out), "address"));
  later(() => endAgent("host", address));
  return address;
}

export const press = (address: string): void => void hcOn("host", ["keys", address, "enter"]);
