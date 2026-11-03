import { test as base } from "@playwright/test";
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
