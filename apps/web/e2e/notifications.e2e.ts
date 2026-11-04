import type { Page } from "@playwright/test";
import { endAgent } from "./agents.ts";
import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";
import {
  askHost,
  deliverPush,
  heldSubscriptions,
  serviceWorker,
  shownNotifications,
  stubPushManager,
  subscribedKey,
  tapNotification,
  TestPushService,
} from "./push.ts";

// One push service and one subscription on the shared e2e host: the specs run in order.
test.describe.configure({ mode: "serial" });
// The headless shell answers Notification.permission with "denied" whatever was granted; full Chromium honours it.
test.use({ channel: "chromium" });

let service: TestPushService;
const started: string[] = [];
test.beforeAll(async () => {
  service = await TestPushService.start();
});
test.afterAll(async () => {
  for (const address of started.splice(0)) endAgent("host", address);
  await service.close();
});

const osc = (fields: string): string => `printf '\\033]7501;${fields}\\033\\\\'`;
const b64 = (text: string): string => Buffer.from(text).toString("base64");

/** Runs `script` on the e2e core as a terminal named `name`; returns its address. */
function run(name: string, script: string): string {
  const out = hcOn("host", ["run", "--bg", "--name", name, "--label", "space=push", "--", "sh", "-c", script]);
  const address = String(Reflect.get(JSON.parse(out), "address"));
  started.push(address);
  return address;
}

/**
 * An agent that works until it gets a line, then draws its prompt and asks for a permission; each answer line is
 * echoed as GOT-A, then GOT-B, so a second keystroke would show.
 */
const askingAgent = (name: string): string =>
  run(
    name,
    [
      osc("state=working:app=claude"),
      "read go",
      "printf 'Allow secret-cmd-7f3?\\n'",
      osc(`state=blocked:kind=permission:app=claude:msg=${b64("Run secret-cmd-7f3")}`),
      "read a",
      "printf 'GOT-A\\n'",
      osc("state=working:app=claude"),
      "read b",
      "printf 'GOT-B\\n'",
      "exec sleep 600",
    ].join("; "),
  );

/** An agent that works until it gets a line, then reports its turn done. */
const finishingAgent = (name: string): string =>
  run(name, [osc("state=working:app=claude"), "read go", osc("state=done:app=claude"), "exec sleep 600"].join("; "));

const press = (address: string): void => void hcOn("host", ["keys", address, "enter"]);
const screen = (address: string): string => hcOn("host", ["read", address]);

/** Settings under the app's own service worker: the first visit installs it, the second runs under it. */
async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Notifications" }).first().click();
}

const pushState = (page: Page) => page.locator("[data-push-state]");

async function turnOn(page: Page): Promise<void> {
  await openSettings(page);
  await expect(pushState(page)).toHaveAttribute("data-push-state", "off");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(pushState(page)).toHaveAttribute("data-push-state", "on");
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await stubPushManager(page, service);
  await page.addInitScript(() => {
    const ask = Notification.requestPermission.bind(Notification);
    Reflect.set(globalThis, "permissionAsks", 0);
    Notification.requestPermission = () => {
      Reflect.set(globalThis, "permissionAsks", Number(Reflect.get(globalThis, "permissionAsks")) + 1);
      return ask();
    };
  });
});

// Through the host, not the page: a test may have closed its page, and no subscription may outlive its test.
test.afterEach(async () => {
  await askHost({ t: "unsubscribe", endpoint: service.endpoint });
});

test("Turn on is the only thing that asks; the host then holds the subscription, and Turn off removes it", async ({
  page,
}) => {
  await openSettings(page);
  await expect(pushState(page)).toHaveAttribute("data-push-state", "off");
  expect(await page.evaluate(() => Reflect.get(globalThis, "permissionAsks"))).toBe(0);
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(pushState(page)).toHaveAttribute("data-push-state", "on");
  expect(await page.evaluate(() => Reflect.get(globalThis, "permissionAsks"))).toBe(1);
  expect(await heldSubscriptions()).toEqual([expect.objectContaining({ endpoint: service.endpoint })]);

  await page.getByRole("button", { name: "Send test" }).click();
  const tested = await service.next();
  expect(tested.notice).toMatchObject({ v: 1, k: "test" });
  expect(tested.vapidKey).toBe(await subscribedKey(page));

  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(pushState(page)).toHaveAttribute("data-push-state", "off");
  expect(await heldSubscriptions()).toEqual([]);
  expect(await subscribedKey(page)).toBeNull();
});

test("a permission prompt sends an opaque notice; Allow answers it while it is on screen, and only once", async ({
  page,
  context,
}) => {
  await turnOn(page);
  const agent = askingAgent("push-ask");
  press(agent);
  const posted = await service.next();
  expect(Object.keys(posted.notice).toSorted()).toEqual(["h", "k", "n", "v"]);
  expect(posted.notice["k"]).toBe("permission");
  const wire =
    JSON.stringify(posted.headers) + Buffer.from(posted.body).toString("latin1") + JSON.stringify(posted.notice);
  for (const plain of ["secret-cmd-7f3", "push-ask", agent, "claude"]) expect(wire).not.toContain(plain);

  const worker = await serviceWorker(context);
  await deliverPush(context, JSON.stringify(posted.notice));
  const tag = String(posted.notice["n"]);
  await expect
    .poll(() => shownNotifications(worker))
    .toEqual([{ title: "doriface", body: "An agent is asking for permission.", tag, actions: ["allow", "deny"] }]);
  await tapNotification(worker, tag, "allow");
  await expect.poll(() => screen(agent)).toContain("GOT-A");

  // The same notice again: the prompt is answered, so nothing is typed and the app opens the pane instead.
  await deliverPush(context, JSON.stringify(posted.notice));
  await tapNotification(worker, tag, "allow");
  await expect(page.locator(`[data-terminal="${agent}"]`)).toBeVisible({ timeout: 15_000 });
  expect(screen(agent)).not.toContain("GOT-B");
});

test("a prompt answered in the terminal first is stale: Allow sends nothing and opens the pane", async ({
  page,
  context,
}) => {
  await turnOn(page);
  const agent = askingAgent("push-stale");
  press(agent);
  const posted = await service.next();
  press(agent);
  await expect.poll(() => screen(agent)).toContain("GOT-A");
  const worker = await serviceWorker(context);
  await deliverPush(context, JSON.stringify(posted.notice));
  await tapNotification(worker, String(posted.notice["n"]), "allow");
  await expect(page.locator(`[data-terminal="${agent}"]`)).toBeVisible({ timeout: 15_000 });
  expect(screen(agent)).not.toContain("GOT-B");
});

test("a tapped notice opens its pane, in an open window and in a fresh one", async ({ page, context }) => {
  await turnOn(page);
  const agent = finishingAgent("push-open");
  press(agent);
  const posted = await service.next();
  expect(posted.notice["k"]).toBe("done");
  const worker = await serviceWorker(context);
  await deliverPush(context, JSON.stringify(posted.notice));
  await tapNotification(worker, String(posted.notice["n"]), "");
  await expect(page.locator(`[data-terminal="${agent}"]`)).toBeVisible({ timeout: 15_000 });

  // With every window closed the worker opens /?notice=<id>; that address alone opens the pane.
  const fresh = await context.newPage();
  await page.close();
  await fresh.goto(`/?notice=${String(posted.notice["n"])}&host=${String(posted.notice["h"])}`);
  await expect(fresh.locator(`[data-terminal="${agent}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(fresh).toHaveURL(/\/$/);
});

test("no notice about the pane this device shows; the other panes still send theirs", async ({ page }) => {
  await turnOn(page);
  const shown = finishingAgent("push-shown");
  const other = finishingAgent("push-other");
  // The app tells the host which pane it shows; the host's ok to that line is when the hold starts.
  const held = new Promise<void>((resolve) => {
    page.on("websocket", (socket) => {
      if (!socket.url().endsWith("/v1/push")) return;
      let told = false;
      socket.on("framesent", ({ payload }) => {
        told ||= Buffer.from(payload).toString().includes(`"terminal":"${shown}"`);
      });
      socket.on("framereceived", ({ payload }) => {
        if (told && Buffer.from(payload).toString().includes('"t":"ok"')) resolve();
      });
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /push-shown/ })
    .first()
    .click();
  await expect(page.locator(`[data-focused="true"] [data-terminal="${shown}"]`)).toBeVisible({ timeout: 15_000 });
  await held;
  const before = service.posted.length;
  press(shown);
  // Its done is in hc before the other agent's starts, so the host decided about it before the other's notice.
  await expect.poll(() => hcOn("host", ["get", shown, "--json"])).toContain('"state":"done"');
  press(other);
  const posted = await service.next();
  expect(await askHost({ t: "notice", id: posted.notice["n"] })).toEqual({
    t: "notice",
    terminal: other,
    kind: "done",
  });
  expect(service.posted).toHaveLength(before + 1);
});
