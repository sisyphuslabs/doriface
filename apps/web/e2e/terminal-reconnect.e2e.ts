import { writeFileSync } from "node:fs";
import { FrameDecoder, FrameKind } from "@doriface/protocol";
import { expect, laidOutBox, openNewTerminal, terminalCount, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** A key press of "q" on a terminal's stream channel. */
const isKeyQ = (frame: { channel: number; kind: number; payload: Uint8Array }) =>
  frame.channel !== 0 && frame.kind === FrameKind.Data && Buffer.from(frame.payload).toString() === "q";

const attaches = (frames: readonly string[]) => frames.filter((frame) => frame.includes('"terminal.attach"'));

test("a connection blip keeps the terminal on screen and runs what was typed meanwhile exactly once", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const input = terminal.getByRole("textbox");
  await input.focus();
  // Several screens of output, so the attach replay carries scrollback as well as the screen.
  await page.keyboard.type("seq 1 200; echo before-$((5+5))");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("before-10", { timeout: 15_000 });
  // Rows are virtualized, so the buffer's length is read from the scroll height over a laid-out row's height: a row
  // read before its layout is 0 high, and the quotient would be Infinity.
  const lines = async () => {
    const row = await laidOutBox(terminal.locator(".term-row:not(.term-scrollback-row)").first());
    return Math.round((await terminal.evaluate((el) => el.scrollHeight)) / row.height);
  };
  const linesBefore = await lines();
  expect(linesBefore).toBeGreaterThan(200);
  const opened = socket.opened();
  const sentBefore = socket.sent().length;

  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  await expect(terminal).toBeVisible();
  await expect(input).toBeFocused();
  // The shell prints typed-42 only when it runs the line; the echoed command line reads typed-$((40+2)).
  await page.keyboard.type("echo typed-$((40+2))");
  await page.keyboard.press("Enter");

  socket.restore();
  await expect.poll(socket.opened, { timeout: 15_000 }).toBeGreaterThan(opened);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeHidden({ timeout: 15_000 });
  await expect(terminal).toContainText("typed-42", { timeout: 15_000 });
  // A later command fences the check: anything replayed twice would have run before it.
  await page.keyboard.type("echo fence-$((1+2))");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("fence-3", { timeout: 15_000 });
  const text = (await terminal.textContent()) ?? "";
  expect(text.match(/typed-42/g)).toHaveLength(1);
  // The reattach replays history into the same view; it must replace what was shown, not append a second copy.
  expect((await lines()) - linesBefore).toBeLessThan(20);
  // The first attach is a plain one; the reattach after the drop carries resumed: true (docs/transport.md).
  expect(attaches(socket.sent().slice(0, sentBefore)).join("")).not.toContain('"resumed"');
  const reattaches = attaches(socket.sent().slice(sentBefore));
  expect(reattaches.length).toBeGreaterThan(0);
  for (const frame of reattaches) expect(frame).toContain('"resumed":true');
});

test("a terminal whose program ends while the connection is down closes its tab once it is back", async ({
  page,
  context,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  const terminal = await openNewTerminal(page);
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  const tabsBefore = await tabs.count();
  // The program ends only once the test creates this file, so it ends while the page is offline.
  const go = test.info().outputPath("go");
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`echo armed-$((3*3)); until [ -e '${go}' ]; do sleep 0.1; done; exit`);
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("armed-9", { timeout: 15_000 });

  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  // A second page on its own connection sees the program end before this one is back.
  const watcher = await context.newPage();
  await watcher.goto("/");
  const live = await terminalCount(watcher);
  writeFileSync(go, "");
  await expect(watcher.getByRole("contentinfo").getByText(new RegExp(`^${live.before - 1} terminals?\\b`))).toBeVisible(
    {
      timeout: 15_000,
    },
  );

  const opened = socket.opened();
  socket.restore();
  await expect.poll(socket.opened, { timeout: 15_000 }).toBeGreaterThan(opened);
  await expect(tabs).toHaveCount(tabsBefore - 1, { timeout: 15_000 });
  await expect(page.getByText(/has finished/)).toHaveCount(0);
});

test("New tab while reconnecting says it could not open one instead of doing nothing", async ({ page }) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(page.getByText("Could not open a new tab")).toBeVisible();
  await expect(page.getByText(/try again once it is back/)).toBeVisible();
  socket.restore();
});

test("the reconnect label counts down to the next attempt", async ({ page }) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  await socket.drop(true);
  // Refused attempts back off 0.5, 1, 2, then 5 s; the 5 s wait must read 5 s and then 4 s.
  const status = page.getByRole("status").filter({ hasText: "Reconnecting" });
  await expect(status).toHaveText("Reconnecting in 5 s", { timeout: 15_000 });
  await expect(status).toHaveText("Reconnecting in 4 s", { timeout: 3_000 });
  socket.restore();
});

test("a reattach while the window is in the background does not tell the core this viewer is in use", async ({
  page,
}) => {
  // Headless Chromium cannot take focus from its window, so the page's view of it is switched instead.
  await page.addInitScript(() => {
    const own = Document.prototype.hasFocus;
    Object.defineProperty(Document.prototype, "hasFocus", {
      value(this: Document) {
        return Reflect.get(window, "windowInBackground") === true ? false : own.call(this);
      },
    });
  });
  const socket = await routeHcSocket(page);
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  await page.evaluate(() => Object.assign(window, { windowInBackground: true }));
  const opened = socket.opened();
  await socket.drop(true);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  const from = socket.sent().length;
  socket.restore();
  await expect.poll(socket.opened, { timeout: 15_000 }).toBeGreaterThan(opened);
  await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeHidden({ timeout: 15_000 });

  // A key typed now is sent after whatever the reattach sent, so once it is on the wire those frames are all there.
  await page.keyboard.type("q");
  // The plain-mode hello line opens each connection; every later message is whole frames.
  const frames = () =>
    socket
      .sent()
      .slice(from)
      .filter((message) => !message.startsWith("{"))
      .flatMap((message) => new FrameDecoder().push(Buffer.from(message, "latin1")));
  await expect.poll(() => frames().some(isKeyQ), { timeout: 15_000 }).toBe(true);
  const focusIn = frames().filter((frame) => frame.kind === FrameKind.Focus && frame.payload[0] === 1);
  expect(focusIn).toHaveLength(0);
});
