import type { Page, Route } from "@playwright/test";
import { expect, openNewTerminal, terminalCount, test } from "./fixtures.ts";
import { routeHcSocket } from "./hc-socket.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** The default close-tab shortcut on this platform's keymap (Cmd+W on macOS, Ctrl+Shift+W elsewhere). */
const CLOSE_TAB = process.platform === "darwin" ? "Meta+KeyW" : "Control+Shift+KeyW";

const focusInside = (page: Page, name: RegExp) =>
  page.getByRole("dialog", { name }).evaluate((dialog) => dialog.contains(document.activeElement));

/** The address of the terminal whose input holds DOM focus, read from document.activeElement. */
const focusedAddress = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement
      ? (active.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null)
      : null;
  });

test("a terminal that becomes ready while Cmd+W's question is open leaves the question open with focus in it", async ({
  page,
}) => {
  const socket = await routeHcSocket(page);
  await page.goto("/");
  await openNewTerminal(page);
  // After a reload every view attaches again; held, the focused one stays connecting until release.
  const release = socket.hold("terminal.attach");
  await page.reload();
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toHaveCount(1, { timeout: 15_000 });
  const address = (await terminal.getAttribute("data-terminal")) ?? "";
  // The view asks to attach once its renderer is up, so its input exists and the attach is in flight.
  await expect
    .poll(() => socket.sent().some((frame) => frame.includes('"method":"terminal.attach"') && frame.includes(address)))
    .toBe(true);
  await expect(terminal).not.toContainText("$");

  await terminal.locator("textarea").focus();
  await page.keyboard.press(CLOSE_TAB);
  const name = /^Close .+\?$/;
  const ask = page.getByRole("dialog", { name });
  await expect(ask).toBeVisible();
  await expect.poll(() => focusInside(page, name)).toBe(true);

  release();
  // The prompt is drawn by the attached stream, so once it shows, the view has finished becoming ready.
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  await expect(ask).toBeVisible();
  expect(await focusInside(page, name)).toBe(true);

  // Esc still answers it: the tab stays and focus goes back to the terminal it was asked from.
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(page.locator(`[data-terminal="${address}"]`)).toHaveCount(1);
  await expect.poll(() => focusedAddress(page)).toBe(address);
});

test("a terminal whose renderer starts while Cmd+W's question is open leaves the question open with focus in it", async ({
  page,
}) => {
  await page.goto("/");
  await openNewTerminal(page);
  // The renderer starts once the wasm core loads; held, every view stays a placeholder until release.
  const held: Route[] = [];
  let releasing = false;
  await page.route("**/*.wasm", (route) => (releasing ? route.continue() : void held.push(route)));
  await page.reload();
  await terminalCount(page);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  const terminal = page.locator('[data-focused="true"]');
  await expect(terminal.locator("[data-terminal]")).toHaveCount(0);

  await page.keyboard.press(CLOSE_TAB);
  const name = /^Close .+\?$/;
  const ask = page.getByRole("dialog", { name });
  await expect(ask).toBeVisible();
  await expect.poll(() => focusInside(page, name)).toBe(true);

  releasing = true;
  await Promise.all(held.splice(0).map((route) => route.continue()));
  await expect(terminal.locator("[data-terminal]")).toContainText("$", { timeout: 15_000 });
  await expect(ask).toBeVisible();
  expect(await focusInside(page, name)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
});
