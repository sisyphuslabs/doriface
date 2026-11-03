import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminalBehindLatency, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

// Over the relay the attach reply arrives after the view has fitted its grid; loopback is too fast to show that.
const RELAY_LATENCY_MS = 300;

let queries = 0;

/** The size the shell's pty reports and the grid the view renders, both as "rows cols". */
async function sizes(page: Page, terminal: Locator): Promise<{ readonly pty: string; readonly view: string }> {
  // Each query has its own tag: under latency the previous reply is still on screen when the next one is typed.
  queries += 1;
  const tag = `pty${queries}`;
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`clear; echo "${tag} $(stty size)"`);
  await page.keyboard.press("Enter");
  const replyText = new RegExp(String.raw`^${tag} \d+ \d+\s*$`);
  const reply = terminal.locator(".term-row:not(.term-scrollback-row)").filter({ hasText: replyText });
  await expect(reply).toHaveCount(1, { timeout: 15_000 });
  const pty = ((await reply.textContent()) ?? "").trim().slice(tag.length + 1);
  // A blank row renders one cell per column, so the last (blank) live row's length is the column count.
  const view = await terminal.evaluate((element) => {
    const rows = element.querySelectorAll(".term-row:not(.term-scrollback-row)");
    return `${rows.length} ${rows[rows.length - 1]?.textContent?.length ?? 0}`;
  });
  return { pty, view };
}

test("a new terminal's pty has the size of the grid it renders", async ({ page }) => {
  const { terminal } = await openNewTerminalBehindLatency(page, RELAY_LATENCY_MS);
  const { pty, view } = await sizes(page, terminal);
  expect(pty).toBe(view);
});

test("a terminal re-attached after the link reconnects has the size of the grid it renders", async ({ page }) => {
  const { link } = await openNewTerminalBehindLatency(page, RELAY_LATENCY_MS);
  const reattached = page.locator('[data-focused="true"] [data-terminal]');
  await link.drop();
  // The workspace goes away while the link is down and comes back with the focused terminal attached again.
  await expect(reattached).toHaveCount(0, { timeout: 15_000 });
  await expect(reattached).toContainText("$", { timeout: 30_000 });
  const { pty, view } = await sizes(page, reattached);
  expect(pty).toBe(view);
});

test("the pty follows the grid when the window resizes", async ({ page }) => {
  const { terminal } = await openNewTerminalBehindLatency(page, RELAY_LATENCY_MS);
  const before = await sizes(page, terminal);
  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => (await sizes(page, terminal)).view).not.toBe(before.view);
  const { pty, view } = await sizes(page, terminal);
  expect(pty).toBe(view);
});

test("the pty follows the grid when the device pixel ratio changes", async ({ page }) => {
  const { terminal } = await openNewTerminalBehindLatency(page, RELAY_LATENCY_MS);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("the page has no viewport");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1.75, mobile: false });
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1.75);
  const { pty, view } = await sizes(page, terminal);
  expect(pty).toBe(view);
});
