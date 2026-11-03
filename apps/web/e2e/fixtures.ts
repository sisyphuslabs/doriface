import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { type HcSocket, routeHcSocket } from "./hc-socket.ts";

/** Pages start with loopback dev settings pointing at the e2e host. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const settings = {
      mode: "loopback",
      relayUrl: "wss://relay-doriface.omo.dev",
      directUrl: "",
      hostId: "",
      loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
      token: E2E_TOKEN,
    };
    await page.addInitScript((value) => localStorage.setItem("doriface.connection", value), JSON.stringify(settings));
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** "4 terminals", optionally followed by " · 1 needs you". */
const TERMINAL_COUNT = /^\d+ terminals?\b/;

/** The status bar's terminal count. It shows only once the core has listed its terminals, so `before` is never a placeholder 0. */
export async function terminalCount(
  page: Page,
): Promise<{ readonly before: number; readonly grown: () => Promise<void> }> {
  const count = page.getByRole("contentinfo").getByText(TERMINAL_COUNT);
  await expect(count).toBeVisible({ timeout: 20_000 });
  const before = Number.parseInt((await count.textContent()) ?? "0", 10);
  const next = new RegExp(`^${before + 1} terminals?\\b`);
  return { before, grown: () => expect(count).toHaveText(next, { timeout: 15_000 }) };
}

/** Opens one more terminal and returns it, pinned by address, once it is the focused pane and its prompt is up. */
export async function openNewTerminal(page: Page): Promise<Locator> {
  const count = await terminalCount(page);
  const focused = page.locator('[data-focused="true"] [data-terminal]');
  if (count.before > 0) await expect(focused).toBeVisible({ timeout: 15_000 });
  const known = new Set(
    await page.locator("[data-terminal]").evaluateAll((els) => els.map((el) => el.getAttribute("data-terminal"))),
  );
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  await count.grown();
  // The focus moves to the new terminal a moment after it registers; until then the old pane is focused.
  await expect
    .poll(
      async () => {
        const address = await focused.getAttribute("data-terminal").catch(() => null);
        return address !== null && !known.has(address);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const address = await focused.getAttribute("data-terminal");
  const terminal = page.locator(`[data-terminal="${address}"]`);
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  return terminal;
}

/** Opens a terminal once the workspace has loaded, with every later frame from the host held `ms`, as over the relay. */
export async function openNewTerminalBehindLatency(
  page: Page,
  ms: number,
): Promise<{ readonly terminal: Locator; readonly link: HcSocket }> {
  const link = await routeHcSocket(page);
  await page.goto("/");
  await terminalCount(page);
  link.delay(ms);
  return { terminal: await openNewTerminal(page), link };
}
