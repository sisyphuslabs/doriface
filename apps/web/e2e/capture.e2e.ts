// Visual QA captures of every app screen against seeded demo data: CAPTURE=1 bunx playwright test capture
import { devices } from "@playwright/test";
import { join } from "node:path";
import { PAIRING_SETTINGS } from "./capture-relay.ts";
import { SHOTS, type Start, type Width } from "./capture-shots.ts";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { test } from "./fixtures.ts";
import { clearLayouts } from "./layout-doc.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");
const BROKEN_STORAGE = `IDBFactory.prototype.open = () => { throw new DOMException("IndexedDB is not available here", "InvalidStateError"); };`;

const STORED: Readonly<Record<Start, string | null>> = {
  connected: JSON.stringify({
    mode: "loopback",
    relayUrl: "",
    directUrl: "",
    hostId: "",
    loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
    token: E2E_TOKEN,
  }),
  pairing: JSON.stringify(PAIRING_SETTINGS),
  none: null,
};

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ page: async ({ page }, use) => use(page), serviceWorkers: "block" });

const contextFor = (width: Width) =>
  width === "1440" ? { viewport: { width: 1440, height: 900 } } : devices["iPhone 14"];

for (const width of ["1440", "390"] as const) {
  for (const theme of ["day", "night"] as const) {
    for (const shot of SHOTS.filter((entry) => entry.only === undefined || entry.only === width)) {
      test(`${shot.name} ${width} ${theme}`, async ({ browser }) => {
        const { defaultBrowserType: _browser, ...use } = { defaultBrowserType: "chromium", ...contextFor(width) };
        clearLayouts();
        const context = await browser.newContext({ ...use, colorScheme: theme === "day" ? "light" : "dark" });
        await context.addInitScript(
          ([chosen, stored]) => {
            localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
            if (stored === null) localStorage.removeItem("doriface.connection");
            else localStorage.setItem("doriface.connection", stored);
          },
          [theme, STORED[shot.start]] as const,
        );
        if (shot.storageFails === true) await context.addInitScript({ content: BROKEN_STORAGE });
        const page = await context.newPage();
        await shot.run(page, width);
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(OUT, `${shot.name}-${width}-${theme}.png`), animations: "disabled" });
        await context.close();
      });
    }
  }
}
