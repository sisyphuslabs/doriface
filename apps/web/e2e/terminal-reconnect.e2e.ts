import { expect, openNewTerminal, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

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
  // Rows are virtualized, so the buffer's length is read from the scroll height.
  const lines = () =>
    terminal.evaluate((el) =>
      Math.round(el.scrollHeight / Number.parseFloat(getComputedStyle(el).getPropertyValue("--term-row-height"))),
    );
  const linesBefore = await lines();
  expect(linesBefore).toBeGreaterThan(200);
  const opened = socket.opened();

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
});
