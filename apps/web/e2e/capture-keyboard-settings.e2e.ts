// Visual QA captures of Settings > Keyboard and the bar it configures, at 390 and 768, in both themes (#770).
// CAPTURE=1 bunx playwright test capture-keyboard-settings
import { join } from "node:path";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { openPhoneTerminal } from "./phone-key-bar.ts";
import { expect, test } from "./fixtures.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");
const STORED = JSON.stringify({
  mode: "loopback",
  relayUrl: "",
  directUrl: "",
  hostId: "",
  loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
  token: E2E_TOKEN,
});

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");

for (const theme of ["day", "night"] as const) {
  for (const width of [390, 768] as const) {
    test(`keyboard settings ${width} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: theme === "day" ? "light" : "dark" });
      await context.addInitScript(
        ([chosen, stored]) => {
          localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
          localStorage.setItem("doriface.connection", stored);
        },
        [theme, STORED] as const,
      );
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto("/settings");
        await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 20_000 });
        if (width === 390) await page.getByRole("tab", { name: "Keyboard" }).click();
        else await page.getByRole("button", { name: "Keyboard", exact: true }).click();
        await page.getByRole("switch", { name: "Add Tmux pack" }).click();
        await page.getByLabel("Key label").fill("Interrupt");
        await page.getByLabel("Keys it sends").fill("Ctrl+C");
        await page.getByRole("button", { name: "Add key" }).click();
        await expect(page.locator("[data-key-bar-preview]")).toBeVisible();
        const body = page.locator("[data-slot=settings-body]");
        await body.evaluate((element) => element.scrollTo(0, 0));
        await page.screenshot({ path: join(OUT, `keyboard-settings-${width}-${theme}.png`) });
        await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
        await page.screenshot({ path: join(OUT, `keyboard-settings-${width}-${theme}-end.png`) });
      } finally {
        await context.close();
      }
    });

    test(`keys bar with a pack ${width} ${theme}`, async ({ browser }) => {
      test.skip(width !== 390, "the phone keys bar is the phone shell's; 768 draws the desktop shell");
      const context = await browser.newContext({ colorScheme: theme === "day" ? "light" : "dark" });
      await context.addInitScript(
        ([chosen, stored]) => {
          localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
          localStorage.setItem("doriface.connection", stored);
        },
        [theme, STORED] as const,
      );
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto("/settings");
        await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 20_000 });
        if (width === 390) await page.getByRole("tab", { name: "Keyboard" }).click();
        else await page.getByRole("button", { name: "Keyboard", exact: true }).click();
        await page.getByRole("switch", { name: "Add Tmux pack" }).click();
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
        await openPhoneTerminal(page, width);
        await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();
        await page.screenshot({ path: join(OUT, `key-bar-packs-${width}-${theme}.png`) });
      } finally {
        await context.close();
      }
    });
  }
}
