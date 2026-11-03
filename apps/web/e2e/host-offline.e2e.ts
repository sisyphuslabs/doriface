import { expect, test } from "./fixtures.ts";

const HC_SOCKET = /\/v1\/hc$/;
const WIRE_TERMS = /\(\d{4}\)|socket|handshake|relay|closed with/i;

test.describe("the screen shown while this device cannot reach its host", () => {
  for (const [code, reason, words] of [
    [4404, "host offline", /isn't connected/],
    [4408, "idle timeout", /didn't answer in time/],
    [4400, "link closed during the handshake", /secure connection to your host failed/],
  ] as const) {
    test(`a ${code} close reads as plain words, and the workspace comes back by itself`, async ({ page }) => {
      let offline = true;
      await page.routeWebSocket(HC_SOCKET, (ws) => {
        if (offline) ws.close({ code, reason });
        else ws.connectToServer();
      });
      await page.goto("/");
      const screen = page.getByRole("status").filter({ hasText: "Cannot reach your host" });
      await expect(screen).toBeVisible({ timeout: 15_000 });
      await expect(screen).toContainText(words);
      await expect(screen).not.toContainText(WIRE_TERMS);

      // The first retries come every 0.5-2 s, each swapping this screen for Connecting; click once it waits longer.
      await expect(screen).toContainText(/Trying again in (5|10) s/, { timeout: 15_000 });
      offline = false;
      await screen.getByRole("button", { name: "Try now" }).click();
      await expect(page.getByRole("contentinfo").getByText(/^\d+ terminals?\b/)).toBeVisible({ timeout: 15_000 });
    });
  }
});
