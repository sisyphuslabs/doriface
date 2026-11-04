import { writeFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";
import { MACHINE_NAME } from "./machine.ts";
import { hcOn, machineRow, newOn } from "./machine-switch.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** The e2e core's answer to terminal.get for `address`: "live" or "finished". */
function stateOnCore(address: string): string {
  const call = { jsonrpc: "2.0", id: 1, method: "terminal.get", params: { terminal: address } };
  const answer = hcOn("host", ["connect"], `${JSON.stringify(call)}\n`)
    .split("\n")
    .find((line) => line.includes('"id":1'));
  const state: unknown = Reflect.get(Reflect.get(JSON.parse(answer ?? "{}"), "result") ?? {}, "state");
  return typeof state === "string" ? state : "unknown";
}

// An added machine's tab waits for the next machine.list read before it follows the feed, so only the view can close it.
test("a terminal on an added machine whose program ends while the connection is down closes its tab once it is back", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
  await newOn(page).click({ force: true });
  const focused = page.locator('[data-focused="true"] [data-terminal]');
  await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${MACHINE_NAME}/t[0-9a-z]+$`), {
    timeout: 15_000,
  });
  const address = (await focused.getAttribute("data-terminal")) ?? "";
  const terminal = page.locator(`[data-terminal="${address}"]`);
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  const tabsBefore = await tabs.count();
  const go = test.info().outputPath("go");
  await terminal.click();
  await page.keyboard.type(`echo armed-$((3*3)); until [ -e '${go}' ]; do sleep 0.1; done; exit`);
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("armed-9", { timeout: 15_000 });

  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  writeFileSync(go, "");
  await expect.poll(() => stateOnCore(address), { timeout: 15_000 }).toBe("finished");

  // The feed's snapshot (its answer and events carry a seq) lands only once the terminal.list answer has rendered, as
  // on a loaded host where the two answers are drawn apart; machine.list answers wait until after it, so the tab's
  // wait for the next machine.list read cannot close it first.
  const snapshot = socket.holdFromHost('"seq":');
  const machineList = socket.holdFromHost('"result":{"machines"');
  const rendered = () =>
    page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const opened = socket.opened();
  const from = socket.received().length;
  socket.restore();
  await expect.poll(socket.opened, { timeout: 15_000 }).toBeGreaterThan(opened);
  await expect
    .poll(() =>
      socket
        .received()
        .slice(from)
        .some((frame) => frame.includes('"terminals":[')),
    )
    .toBe(true);
  await rendered();
  snapshot();
  await rendered();
  machineList();

  // The page attached this program before the drop: it ended, so its tab closes as the CLOSE it missed would have.
  await expect(tabs).toHaveCount(tabsBefore - 1, { timeout: 15_000 });
  await expect(page.getByText("This terminal didn't open")).toHaveCount(0);
});
