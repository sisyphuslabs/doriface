import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { type FakeRelayHost, startFakeRelayHost } from "./relay-route.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

/** Either sentence the app says about a host that is gone: the relay's own code decides which (#477, #486). */
const NOT_ANSWERING = /Your host isn't (answering|connected right now)/;

/** Settings > Paired devices, which names the host this device is paired with. */
const paired = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Paired devices" }) });

/**
 * The host row's title: the section's rows are "This browser" and then the host, each a title paragraph and a
 * description paragraph, so the host's title is the third (#496).
 */
const hostName = (page: Page) => paired(page).getByRole("paragraph").nth(2);

async function pair(page: Page, host: FakeRelayHost): Promise<void> {
  await host.route(page);
  await page.goto(await host.pairingLink());
  await page.getByRole("button", { name: "They match" }).click({ timeout: 30_000 });
  await expect(page.getByRole("status").getByText("Paired")).toBeVisible({ timeout: 30_000 });
  // The fixture seeds loopback settings on every load, so the paired link is seeded again for the loads after this one.
  await page.addInitScript((value) => localStorage.setItem("doriface.connection", value), await stored(page));
}

async function stored(page: Page): Promise<string> {
  const value = await page.evaluate(() => localStorage.getItem("doriface.connection"));
  if (value === null) throw new Error("the app saved no connection");
  return value;
}

for (const width of [1440, 390]) {
  test(`at ${width} px, the row keeps the host's name while the host is down, and after a fresh load (#496)`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const host = await startFakeRelayHost();
    try {
      await page.setViewportSize({ width, height: 900 });
      await pair(page, host);

      await page.goto("/settings");
      await expect(paired(page)).toContainText("Connected", { timeout: 30_000 });
      const name = (await hostName(page).innerText()).trim();
      const hostId = (JSON.parse(await stored(page)) as { hostId?: string }).hostId ?? "";
      expect(name).not.toBe("");
      expect(name).not.toBe("This browser");
      expect(hostId.length).toBeGreaterThan(0);
      expect(name).not.toContain(hostId);

      // A later load starts from what the app itself saved, the way a phone that reopens the page does.
      const saved = await stored(page);
      await page.addInitScript((value) => localStorage.setItem("doriface.connection", value), saved);

      await host.stop();
      await expect(paired(page)).toContainText(NOT_ANSWERING, { timeout: 30_000 });
      await expect(hostName(page)).toHaveText(name);
      expect(await hostName(page).innerText()).not.toContain(hostId);

      await page.reload();
      await expect(paired(page)).toContainText(NOT_ANSWERING, { timeout: 30_000 });
      await expect(hostName(page)).toHaveText(name);
      expect(await hostName(page).innerText()).not.toContain(hostId);
    } finally {
      await host.stop();
    }
  });
}
