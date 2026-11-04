// New tab focuses the terminal it started even when the feed lists that terminal after another machine.list read has
// come back: the tab waits for its terminal instead of being dropped as gone. A terminal is already open, as in a
// workspace in use; with none, the first-live rule would reopen the new one and hide the drop.
import { expect, openNewTerminal, terminalCount, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

const idOf = (frame: string): string | undefined => /"id":(\d+)/.exec(frame)?.[1];

test("a New tab whose terminal the feed lists only after a machine.list read still opens and takes focus", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  const answersTo = (method: string): readonly string[] => {
    const ids = new Set(
      socket
        .sent()
        .filter((frame) => frame.includes(`"method":"${method}"`))
        .map(idOf),
    );
    return socket.received().filter((frame) => frame.includes('"result"') && ids.has(idOf(frame)));
  };
  const answers = (method: string): number => answersTo(method).length;
  const started = answers("terminal.run");
  // The feed (events.subscribe's channel) falls behind the RPC answers, as on a loaded host: its events, heartbeats and
  // resyncs wait, in order, while terminal.run and machine.list answer.
  const release = socket.holdFromHost('"method":"event"', '"method":"heartbeat"', '"method":"missed"');
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  await expect.poll(() => answers("terminal.run"), { timeout: 15_000 }).toBe(started + 1);
  const address = /"address":"([^"]+)"/.exec(answersTo("terminal.run").at(-1) ?? "")?.[1];
  if (address === undefined) throw new Error("terminal.run answered without an address");

  // A machine.list read lands while the feed has not listed the new terminal yet (the timer does this every 10 s).
  const listed = answers("machine.list");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => answers("machine.list"), { timeout: 15_000 }).toBeGreaterThan(listed);
  release();

  const focused = page.locator(`[data-focused="true"] [data-terminal="${address}"]`);
  await expect(focused).toBeVisible({ timeout: 15_000 });
  await expect(focused).toContainText("$", { timeout: 15_000 });
});

// The other order: the feed lists the terminal before terminal.run answers. Once listed, the feed and machine.list are
// held until focus has moved, so nothing but the answer can move it: the new tab must take focus as the answer lands,
// not on a later event. The holds prove the order; how long the page takes to render it depends on the host.

test("a New tab whose terminal the feed lists before terminal.run answers takes focus as the answer lands", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  const count = await terminalCount(page);
  const focused = page.locator('[data-focused="true"] [data-terminal]');
  const before = await focused.getAttribute("data-terminal");
  const releaseList = socket.hold("machine.list");
  const releaseAnswers = socket.holdFromHost('"result"');
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  await count.grown();
  const releaseFeed = socket.holdFromHost('"method":"event"', '"method":"heartbeat"', '"method":"missed"');
  releaseAnswers();
  await expect
    .poll(async () => (await focused.getAttribute("data-terminal").catch(() => null)) !== before, {
      intervals: [10],
      timeout: 5_000,
    })
    .toBe(true);
  releaseFeed();
  releaseList();
});
