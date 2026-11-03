// Visual QA captures against seeded demo data: CAPTURE=1 bunx playwright test capture
import { devices, type Page } from "@playwright/test";
import { join } from "node:path";
import { hostIdOf } from "../src/pair/fragment.ts";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { expect, test } from "./fixtures.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");
const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const signPub = new Uint8Array(32).map((_, index) => (index * 37 + 11) % 256);
const noisePub = new Uint8Array(32).map((_, index) => (index * 53 + 7) % 256);
const PAIR_LINK = `/pair#h=${hostIdOf(signPub)}&k=${b64url(noisePub)}&s=${b64url(signPub)}&p=${b64url(new Uint8Array(32).fill(3))}&r=wss://relay-doriface.omo.dev`;

type Width = "1440" | "390";
type Theme = "day" | "night";
interface Shot {
  readonly name: string;
  readonly connected: boolean;
  readonly run: (page: Page, width: Width) => Promise<void>;
}

const focusedTerminal = (page: Page) => page.locator('[data-focused="true"] [data-terminal]');
/** Opens the seeded terminal whose sidebar row matches, so the shot never depends on which tab opened first. */
const openTerminal = async (page: Page, name: RegExp, text: string | RegExp) => {
  await page.getByRole("button", { name }).first().click();
  await expect(focusedTerminal(page)).toContainText(text, { timeout: 15_000 });
};

const SHOTS: readonly Shot[] = [
  {
    name: "workspace",
    connected: true,
    run: async (page, width) => {
      await page.goto("/");
      if (width === "390") return void (await expect(page.getByText("Needs you")).toBeVisible());
      await openTerminal(page, /shell/, "$");
      await openTerminal(page, /deploy/, "Waiting for approval");
      await page.getByRole("button", { name: "Split" }).click();
    },
  },
  {
    name: "terminal",
    connected: true,
    run: async (page, width) => {
      await page.goto("/");
      if (width === "1440") return openTerminal(page, /shell/, "$");
      await page
        .getByRole("button", { name: /deploy/ })
        .first()
        .click();
      await expect(page.locator("[data-terminal]")).toContainText("Waiting for approval", { timeout: 15_000 });
    },
  },
  { name: "first-run", connected: false, run: async (page) => void (await page.goto("/")) },
  { name: "pair", connected: false, run: async (page) => void (await page.goto("/pair")) },
  { name: "pair-verify", connected: false, run: async (page) => void (await page.goto(PAIR_LINK)) },
  { name: "settings", connected: true, run: async (page) => void (await page.goto("/settings")) },
  {
    name: "settings-appearance",
    connected: true,
    run: async (page) => {
      await page.goto("/settings");
      await page
        .getByRole("tab", { name: "Appearance" })
        .or(page.getByRole("button", { name: "Appearance" }))
        .first()
        .click();
    },
  },
  ...(["Terminal", "Keybindings"] as const).map((label): Shot => ({
    name: `settings-${label.toLowerCase()}`,
    connected: true,
    run: async (page) => {
      await page.goto("/settings");
      await page
        .getByRole("tab", { name: label })
        .or(page.getByRole("button", { name: label }))
        .first()
        .click();
      await expect(page.getByRole("heading", { name: label, level: 2 })).toBeVisible();
    },
  })),
];

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ page: async ({ page }, use) => use(page) });

const contextFor = (width: Width) =>
  width === "1440" ? { viewport: { width: 1440, height: 900 } } : devices["iPhone 14"];

for (const width of ["1440", "390"] as const) {
  for (const theme of ["day", "night"] as const satisfies readonly Theme[]) {
    for (const shot of SHOTS) {
      test(`${shot.name} ${width} ${theme}`, async ({ browser }) => {
        const { defaultBrowserType: _browser, ...use } = { defaultBrowserType: "chromium", ...contextFor(width) };
        const context = await browser.newContext({ ...use, colorScheme: theme === "day" ? "light" : "dark" });
        const connection = shot.connected
          ? {
              mode: "loopback",
              relayUrl: "",
              directUrl: "",
              hostId: "",
              loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
              token: E2E_TOKEN,
            }
          : null;
        await context.addInitScript(
          ([chosen, stored]) => {
            localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
            if (stored === null) localStorage.removeItem("doriface.connection");
            else localStorage.setItem("doriface.connection", stored);
          },
          [theme, connection === null ? null : JSON.stringify(connection)] as const,
        );
        const page = await context.newPage();
        await shot.run(page, width);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(OUT, `${shot.name}-${width}-${theme}.png`) });
        await context.close();
      });
    }
  }
}
