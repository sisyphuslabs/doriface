// The workspace with an added machine, in both themes at 1440 and 390: CAPTURE=1 bunx playwright test machines
import { devices, type Page } from "@playwright/test";
import { join } from "node:path";
import { E2E_HOST_PORT, E2E_TOKEN } from "./config.ts";
import { MACHINE_NAME } from "./machine.ts";
import { expect, test } from "./fixtures.ts";

const OUT = join(import.meta.dirname, "../../../docs/design/app");

test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ page: async ({ page }, use) => use(page) });

const machineRow = (page: Page) => page.getByRole("button", { name: new RegExp(`^${MACHINE_NAME}\\b`) });

async function showMachines(page: Page, width: "1440" | "390"): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Machines" })).toBeVisible({ timeout: 20_000 });
  await expect(machineRow(page)).toContainText("connected", { timeout: 20_000 });
  if (width === "390") {
    await page
      .getByRole("heading", { name: "Machines" })
      .evaluate((heading) => heading.scrollIntoView({ block: "center" }));
    return;
  }
  await page.getByRole("button", { name: `New terminal on ${MACHINE_NAME}` }).click({ force: true });
  const focused = page.locator('[data-focused="true"] [data-terminal]');
  await expect(focused).toHaveAttribute("data-terminal", new RegExp(`^${MACHINE_NAME}/t\\d+$`), { timeout: 15_000 });
  await expect(page.locator('[data-focused="true"] header')).toContainText(`${MACHINE_NAME}/t`);
  await focused.click();
  // A login shell's prompt names the machine and user running the capture; a neutral one keeps them out of it.
  await page.keyboard.type("PS1='$ '; clear\r");
  await page.keyboard.type("echo on-build-box-$((40 + 2))\r");
  await expect(focused).toContainText("on-build-box-42", { timeout: 15_000 });
}

for (const width of ["1440", "390"] as const) {
  for (const theme of ["day", "night"] as const) {
    test(`machines ${width} ${theme}`, async ({ browser }) => {
      const size = width === "1440" ? { viewport: { width: 1440, height: 900 } } : devices["iPhone 14"];
      const { defaultBrowserType: _browser, ...use } = { defaultBrowserType: "chromium", ...size };
      const context = await browser.newContext({ ...use, colorScheme: theme === "day" ? "light" : "dark" });
      const connection = {
        mode: "loopback",
        relayUrl: "",
        directUrl: "",
        hostId: "",
        loopbackUrl: `ws://127.0.0.1:${E2E_HOST_PORT}/v1/hc`,
        token: E2E_TOKEN,
      };
      await context.addInitScript(
        ([chosen, stored]) => {
          localStorage.setItem("doriface.appearance", JSON.stringify({ theme: chosen, custom: [] }));
          localStorage.setItem("doriface.connection", stored);
        },
        [theme, JSON.stringify(connection)] as const,
      );
      const page = await context.newPage();
      await showMachines(page, width);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(OUT, `machines-${width}-${theme}.png`) });
      if (width === "1440") {
        await page.keyboard.type("exit\r");
        await expect(machineRow(page)).toContainText(/connected\s*2/, { timeout: 15_000 });
      }
      await context.close();
    });
  }
}
