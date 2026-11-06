import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { type FakeRelayHost, startFakeRelayHost } from "./relay-route.ts";

test.use({ serviceWorkers: "block" });

const INVITE = /invite link a member sent you/;
const PAIRED = "This device now reaches the host through the relay";
const FINGERPRINT = { hasText: "Host key (SHA-256)" };

async function desktopBrowser(browser: Browser, host: FakeRelayHost): Promise<Page> {
  const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await host.route(page);
  return page;
}

async function pairScreen(page: Page): Promise<void> {
  await expect(page.getByText(INVITE)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: "Pair a host" })
    .or(page.getByRole("button", { name: "Pair a host" }))
    .click();
}

async function confirmAndPair(page: Page): Promise<void> {
  await expect(page.getByRole("figure").filter(FINGERPRINT)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "They match" }).click();
  await expect(page.getByText(PAIRED)).toBeVisible({ timeout: 90_000 });
}

test("a desktop browser joins by clicking the invite link", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await startFakeRelayHost({ machine: true });
  try {
    const { link } = await host.pairingOffer();
    const page = await desktopBrowser(browser, host);
    await page.goto(link);
    await confirmAndPair(page);
  } finally {
    await host.stop();
  }
});

test("a desktop browser joins by pasting the invite link", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await startFakeRelayHost({ machine: true });
  try {
    const { link } = await host.pairingOffer();
    const page = await desktopBrowser(browser, host);
    await page.goto("/");
    await pairScreen(page);
    await page.getByRole("textbox").first().fill(link);
    await page.getByRole("button", { name: "Pair", exact: true }).click();
    await confirmAndPair(page);
  } finally {
    await host.stop();
  }
});

test("a desktop browser joins by typing the code the host shows", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await startFakeRelayHost({ machine: true });
  try {
    const { code } = await host.pairingOffer();
    const page = await desktopBrowser(browser, host);
    await page.goto("/");
    await pairScreen(page);
    await page
      .getByRole("textbox")
      .first()
      .fill(`${code.slice(0, 4)} ${code.slice(4)}`);
    await page.getByRole("button", { name: "Pair", exact: true }).click();
    await confirmAndPair(page);
  } finally {
    await host.stop();
  }
});
