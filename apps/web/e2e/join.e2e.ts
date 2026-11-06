import type { Browser, Locator, Page } from "@playwright/test";
import { expect, pressNewTab, test } from "./fixtures.ts";
import { type FakeRelayHost, startFakeRelayHost } from "./relay-route.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const INVITE = /invite link a member sent you/;
const PAIRED = "This device now reaches the host through the relay";

/** A browser that has never paired: its own storage and key, and no seeded settings, so the app's landing shows. */
async function freshBrowser(browser: Browser, host: FakeRelayHost): Promise<Page> {
  const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await host.route(page);
  return page;
}

async function newTerminal(page: Page): Promise<Locator> {
  const button = page
    .getByRole("button", { name: "New tab" })
    .or(page.getByRole("button", { name: "New terminal" }))
    .first();
  await pressNewTab(button, { timeout: 60_000 });
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$", { timeout: 30_000 });
  return terminal;
}

test("a browser with no pairing joins by an invite, takes input on a terminal, and is still joined after a reload", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const host = await startFakeRelayHost({ machine: true });
  try {
    const page = await freshBrowser(browser, host);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Connect to a host" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(INVITE)).toBeVisible();

    await page.goto(await host.pairingLink());
    await expect(page.getByRole("button", { name: "They match" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "They match" }).click();
    await expect(page.getByText(PAIRED)).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole("link", { name: "Open terminals" })
      .or(page.getByRole("button", { name: "Open terminals" }))
      .click();

    const terminal = await newTerminal(page);
    await terminal.getByRole("textbox").focus();
    await page.keyboard.type("echo joined-$((6*7))");
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("joined-42", { timeout: 30_000 });

    // A revisit needs no new invite: the browser kept its device key and the pairing it saved.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Connect to a host" })).toHaveCount(0);
    await expect(page.locator("[data-terminal]").first()).toBeVisible({ timeout: 60_000 });
    await page.context().close();
  } finally {
    await host.stop();
  }
});
