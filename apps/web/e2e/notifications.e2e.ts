import { expect, test } from "./fixtures.ts";
import { hcOn } from "./machine-switch.ts";
import { askHost, deliverPush, heldSubscriptions, serviceWorker, subscribedKey, tapNotification } from "./push.ts";
import { finishingAgent, openSettings, press, pushState, pushSuite, turnOn } from "./push-suite.ts";

const suite = pushSuite();

test("Turn on is the only thing that asks; the host then holds the subscription, and Turn off removes it", async ({
  page,
}) => {
  const service = suite.service();
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

test("a tapped notice opens its pane, in an open window and in a fresh one", async ({ page, context }) => {
  const service = suite.service();
  await turnOn(page);
  const agent = finishingAgent("push-open", suite.later);
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
  const service = suite.service();
  await turnOn(page);
  const shown = finishingAgent("push-shown", suite.later);
  const other = finishingAgent("push-other", suite.later);
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
