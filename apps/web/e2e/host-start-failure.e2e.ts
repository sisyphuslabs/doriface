import { expect, test } from "@playwright/test";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const FAILURE = {
  code: "hc-binary-missing",
  message: "herdr-core was not found on PATH (hc)",
  path: "hc",
  details: "doriface-host exited before listening (code 4):\ndoriface-host: herdr-core was not found on PATH (hc)",
};

test("a desktop host that did not start shows its cause, keeps the raw output behind Details, and Retry starts it again", async ({
  page,
}) => {
  await page.addInitScript(
    ([failure, endpoint]) => {
      localStorage.removeItem("doriface.connection");
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
    [FAILURE, { url: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`, token: E2E_TOKEN }] as const,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Use this computer" }).click();

  const notice = page.getByRole("alert").filter({ hasText: "This computer's host did not start" });
  await expect(notice).toContainText("herdr-core was not found on this computer.");
  await expect(notice.locator("details pre")).toBeHidden();
  await notice.locator("details summary").click();
  await expect(notice.locator("details pre")).toHaveText(FAILURE.details);

  await notice.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Use this computer" })).toHaveCount(0, { timeout: 15_000 });
  await expect(notice).toHaveCount(0);
});

test("herdr-core not found offers Choose hc, and a chosen file starts the host again", async ({ page }) => {
  await page.addInitScript(
    ([failure, endpoint]) => {
      localStorage.removeItem("doriface.connection");
      let starts = 0;
      let chosen = false;
      Object.defineProperty(window, "doriface", {
        value: {
          startLocalHost: async () => {
            starts += 1;
            return chosen ? endpoint : { failure };
          },
          chooseHc: async () => {
            chosen = true;
            return "/opt/herdr/hc";
          },
        },
      });
    },
    [FAILURE, { url: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`, token: E2E_TOKEN }] as const,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Use this computer" }).click();
  const notice = page.getByRole("alert").filter({ hasText: "This computer's host did not start" });
  await expect(notice).toContainText("herdr-core was not found on this computer.");
  await notice.getByRole("button", { name: "Choose hc…" }).click();
  await expect(page.getByRole("button", { name: "Use this computer" })).toHaveCount(0, { timeout: 15_000 });
  await expect(notice).toHaveCount(0);
});

test("a shell without Choose hc, or a failure hc has nothing to do with, shows no Choose hc", async ({ page }) => {
  await page.addInitScript(
    (failure) => {
      localStorage.removeItem("doriface.connection");
      Object.defineProperty(window, "doriface", {
        value: { startLocalHost: async () => ({ failure }), chooseHc: async () => null },
      });
    },
    { ...FAILURE, code: "port-in-use", address: "127.0.0.1:1" },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Use this computer" }).click();
  const notice = page.getByRole("alert").filter({ hasText: "This computer's host did not start" });
  await expect(notice).toContainText("is already in use");
  await expect(notice.getByRole("button", { name: "Choose hc…" })).toHaveCount(0);
});
