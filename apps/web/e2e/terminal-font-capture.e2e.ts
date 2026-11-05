import { join } from "node:path";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`configured Nerd Font at 16 points, ${colorScheme} ${width}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "MacIntel" }));
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await openNewTerminal(page);
      await page.getByRole("link", { name: "Settings" }).first().click();
      await page
        .getByRole("tab", { name: "Terminal", exact: true })
        .or(page.getByRole("button", { name: "Terminal", exact: true }))
        .first()
        .click();
      await page.getByRole("textbox", { name: "font-size", exact: true }).fill("16");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Add font-family", exact: true }).click();
      await page.keyboard.type("'GeistMono Nerd Font Mono'");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Close settings" }).first().click();
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      if (width === 390) await page.getByRole("button", { name: /Idle bash web/ }).click();
      const terminal = page.locator("[data-terminal]:visible").first();
      await expect(terminal).toContainText("$");
      const output =
        "Ghostty font-size = 16\nGeistMono Nerd Font Mono\n\n\uf015  home  \ue0b0  \uf07b  project\n0123456789 ABCDEFGHIJKLM\nabcdefghijklmnopqrstuvwxyz\n";
      const octal = [...new TextEncoder().encode(output)].map((byte) => `\\${byte.toString(8)}`).join("");
      await terminal.getByRole("textbox").focus();
      await page.keyboard.type(`printf '\\033[2J\\033[H${octal}'; PS1='$ '`);
      await page.keyboard.press("Enter");
      await expect(terminal).toContainText("GeistMono Nerd Font Mono");
      await expect.poll(() => terminal.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
      const filename = `terminal-font-${colorScheme}-${width}.png`;
      const dir = process.env["FONT_SCREENSHOT_DIR"];
      await page.screenshot({ path: dir === undefined ? testInfo.outputPath(filename) : join(dir, filename) });
    });
  }
}
