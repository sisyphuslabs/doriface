import type { Locator, Page } from "@playwright/test";
import { E2E_TOKEN } from "./config.ts";
import { expect, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const FAILURE = {
  code: "hc-binary-missing",
  message: "herdr-core was not found on PATH (hc)",
  path: "hc",
  details: "doriface-host exited before listening (code 4):\ndoriface-host: herdr-core was not found on PATH (hc)",
};

/** Boots with a saved This computer link whose host fails to start once, then starts on Retry; returns the page's sockets. */
async function bootFailing(page: Page, loopbackUrl: string): Promise<string[]> {
  // The saved link points at this worker's e2e host, which answers: a silent fallback to it would connect.
  const saved = {
    mode: "loopback",
    relayUrl: "",
    directUrl: "",
    hostId: "",
    hostKey: "",
    loopbackUrl,
    token: E2E_TOKEN,
  };
  await page.addInitScript(
    ([failure, link, endpoint]) => {
      localStorage.setItem("doriface.connection", JSON.stringify(link));
      let starts = 0;
      Object.defineProperty(window, "doriface", {
        value: {
          startLocalHost: async () => {
            starts += 1;
            return starts === 1 ? { failure } : endpoint;
          },
        },
      });
    },
    [FAILURE, saved, { url: loopbackUrl, token: E2E_TOKEN }] as const,
  );
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  return sockets;
}

/** A part's box; a part without one fails the test where it is measured. */
async function boxOf(part: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await part.boundingBox();
  expect(box, "a measured part has a box").not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

const notice = (page: Page) => page.getByRole("alert").filter({ hasText: "This computer's host did not start" });

test("a saved This computer link whose host does not start at boot shows the typed cause with Retry and Settings, and connects nowhere until Retry", async ({
  page,
  loopbackUrl,
}) => {
  const sockets = await bootFailing(page, loopbackUrl);
  const shown = notice(page);
  await expect(shown.locator("[data-host-start-code]")).toHaveAttribute("data-host-start-code", "hc-binary-missing");
  await expect(shown).toContainText("herdr-core was not found on this computer.");
  await expect(shown.locator("details pre")).toBeHidden();
  await expect(shown.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "/settings");
  // The boot has settled on the notice: no connection was made to the saved link behind it.
  expect(sockets).toEqual([]);

  await shown.getByRole("button", { name: "Retry" }).click();
  await expect(shown).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("tablist", { name: "Tabs" })).toBeVisible({ timeout: 15_000 });
  expect(sockets.length).toBeGreaterThan(0);
  expect(sockets.every((url) => url.startsWith(loopbackUrl))).toBe(true);
});

for (const width of [320, 390] as const) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("the message keeps the notice's full width and Retry and Open settings sit under it", async ({
      page,
      loopbackUrl,
    }) => {
      await bootFailing(page, loopbackUrl);
      const shown = notice(page);
      const message = shown.locator("[data-host-start-code]");
      const retry = shown.getByRole("button", { name: "Retry" });
      const settings = shown.getByRole("link", { name: "Open settings" });
      await expect(settings).toBeVisible({ timeout: 20_000 });
      const [box, text, first, second] = await Promise.all([
        boxOf(shown),
        boxOf(message),
        boxOf(retry),
        boxOf(settings),
      ]);
      // Beside the actions the message was squeezed to about 120 px at 390; under them it spans the text column.
      expect(text.width, "the message's width").toBeGreaterThanOrEqual(box.width * 0.75);
      expect(box.x, "the notice starts inside the viewport").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "the notice ends inside the viewport").toBeLessThanOrEqual(width + 1);
      for (const action of [first, second]) {
        expect(action.y, "an action starts below the message").toBeGreaterThanOrEqual(text.y + text.height);
        expect(action.x + action.width, "an action ends inside the notice").toBeLessThanOrEqual(box.x + box.width + 1);
      }
    });
  });
}
