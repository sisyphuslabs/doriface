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

test("a saved This computer link whose host does not start at boot shows the typed cause with Retry and Settings, and connects nowhere until Retry", async ({
  page,
  loopbackUrl,
}) => {
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

  const notice = page.getByRole("alert").filter({ hasText: "This computer's host did not start" });
  await expect(notice.locator("[data-host-start-code]")).toHaveAttribute("data-host-start-code", "hc-binary-missing");
  await expect(notice).toContainText("herdr-core was not found on this computer.");
  await expect(notice.locator("details pre")).toBeHidden();
  await expect(notice.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "/settings");
  // The boot has settled on the notice: no connection was made to the saved link behind it.
  expect(sockets).toEqual([]);

  await notice.getByRole("button", { name: "Retry" }).click();
  await expect(notice).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("tablist", { name: "Tabs" })).toBeVisible({ timeout: 15_000 });
  expect(sockets.length).toBeGreaterThan(0);
  expect(sockets.every((url) => url.startsWith(loopbackUrl))).toBe(true);
});
