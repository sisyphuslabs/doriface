import { devices, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { loadKoreanFonts } from "./korean-fonts.ts";

// Captures for #410: the reported line at both widths in both themes, of the terminal with GeistMono Nerd Font Mono and
// IBM Plex Sans KR at 16 pt with 10% extra cell height. Run with CAPTURE=1 and F410_DIR=<dir>.
test.skip(process.env["CAPTURE"] !== "1", "captures run only with CAPTURE=1");
test.use({ serviceWorkers: "block" });

const LINE = "\u{C548}\u{B155}\u{D558}\u{C138}\u{C694} doriface \u{D55C}\u{AE00} \u{D14C}\u{C2A4}\u{D2B8}";
const DIR = process.env["F410_DIR"] ?? ".";
const STATE = process.env["F410_STATE"] ?? "after";

const octalOf = (text: string): string =>
  [...new TextEncoder().encode(text)].map((byte) => `\\${byte.toString(8)}`).join("");

async function print(page: Page, terminal: Locator): Promise<void> {
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`printf '${octalOf(LINE)}\\n'`);
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".term-row").filter({ hasText: "doriface" })).not.toHaveCount(0, { timeout: 30_000 });
}

async function useReportedFont(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page
    .getByRole("tab", { name: "Terminal", exact: true })
    .or(page.getByRole("button", { name: "Terminal", exact: true }))
    .first()
    .click();
  for (const [name, value] of [
    ["font-size", "16"],
    ["adjust-cell-height", "10%"],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- commit each setting before the next one
    await page.getByRole("textbox", { name, exact: true }).fill(value);
    // oxlint-disable-next-line no-await-in-loop -- commits this field
    await page.keyboard.press("Enter");
  }
  for (const name of ["Terminal Latin Fixture", "Terminal Korean Fixture"]) {
    // oxlint-disable-next-line no-await-in-loop -- font order is the setting under test
    await page.getByRole("button", { name: "Add font-family", exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- the field was just added
    await page.keyboard.type(name);
    // oxlint-disable-next-line no-await-in-loop -- commits this family
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Close settings" }).first().click();
  await expect(page.locator('[data-focused="true"] [data-terminal]')).toContainText("$", { timeout: 20_000 });
}

async function capture(terminal: Locator, name: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await terminal.screenshot({ path: join(DIR, `${STATE}-${name}.png`) });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`desktop ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

    test(`capture 1440 ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto("/");
      await loadKoreanFonts(page);
      await openNewTerminal(page);
      await useReportedFont(page);
      const terminal = page.locator('[data-focused="true"] [data-terminal]');
      await print(page, terminal);
      await capture(terminal, `1440-${scheme}`);
    });
  });

  test.describe(`phone ${scheme}`, () => {
    const { defaultBrowserType: _browser, ...phone } = devices["iPhone 14"];
    test.use({ ...phone, colorScheme: scheme, serviceWorkers: "block" });

    test(`capture 390 ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto("/");
      await loadKoreanFonts(page);
      await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("banner").getByRole("button", { name: "New tab" }).click();
      const terminal = page.locator("[data-terminal]").first();
      await expect(terminal).toContainText("$", { timeout: 15_000 });
      await print(page, terminal);
      await capture(terminal, `390-${scheme}`);
    });
  });
}
