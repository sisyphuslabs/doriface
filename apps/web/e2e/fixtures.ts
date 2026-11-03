import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";

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

/** The status bar's terminal count, once the workspace has loaded. */
export async function terminalCount(
  page: Page,
): Promise<{ readonly before: number; readonly grown: () => Promise<void> }> {
  const count = page.getByRole("contentinfo").getByText(TERMINAL_COUNT);
  await expect(count).toBeVisible({ timeout: 20_000 });
  const before = Number.parseInt((await count.textContent()) ?? "0", 10);
  const next = new RegExp(`^${before + 1} terminals?\\b`);
  return { before, grown: () => expect(count).toHaveText(next, { timeout: 15_000 }) };
}

/** Opens one more terminal and returns the focused pane once its prompt is up. */
export async function openNewTerminal(page: Page): Promise<Locator> {
  const count = await terminalCount(page);
  await page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first()
    .click();
  await count.grown();
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$", { timeout: 15_000 });
  return terminal;
}
