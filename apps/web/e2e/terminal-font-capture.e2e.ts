import { join } from "node:path";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// Each case goes through Settings, types a printf and takes a DPR 2 full-page screenshot: no single step hangs, but on a
// loaded runner the whole case passes 60 s. A real hang still fails, at three times that.
test.slow();

/** `text` for printf: ASCII as is, every other byte (and printf's own \ % ') as octal, so little is typed. */
const printfText = (text: string): string =>
  [...new TextEncoder().encode(text)]
    .map((byte) => {
      if (byte === 0x0a) return "\\n";
      const plain = byte >= 0x20 && byte < 0x7f && byte !== 0x5c && byte !== 0x25 && byte !== 0x27;
      return plain ? String.fromCharCode(byte) : `\\${byte.toString(8)}`;
    })
    .join("");

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`configured Nerd Font at 16 points, ${colorScheme} ${width}`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      const opened = await openNewTerminal(page);
      const address = (await opened.getAttribute("data-terminal")) ?? "";
      // A tab reads its number, as herdr-app's, with no tooltip: the session's name is on its actions.
      const actions = page.getByRole("button", { name: /^Session actions for / });
      const name = ((await actions.getAttribute("aria-label")) ?? "").replace(/^Session actions for /, "");
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
      // The phone list shows every agent; this one is the row named after the terminal opened above.
      if (width === 390) {
        await page
          .getByRole("button", { name: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) })
          .first()
          .click();
      }
      const terminal = page.locator(`[data-terminal="${address}"]:visible`);
      await expect(terminal).toContainText("$");
      const output =
        "Ghostty font-size = 16\nGeistMono Nerd Font Mono\n\n\uf015  home  \ue0b0  \uf07b  project\n0123456789 ABCDEFGHIJKLM\nabcdefghijklmnopqrstuvwxyz\n";
      await terminal.getByRole("textbox").focus();
      await page.keyboard.type(`printf '\\033[2J\\033[H${printfText(output)}'; PS1='$ '`);
      await page.keyboard.press("Enter");
      await expect(terminal).toContainText("GeistMono Nerd Font Mono");
      // Ghostty's 16 points as CSS pixels on this platform: 1:1 on Apple platforms, 96/72 elsewhere.
      const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform));
      const px = 16 * (apple ? 1 : 96 / 72);
      await expect.poll(() => terminal.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(px, 3);
      const filename = `terminal-font-${colorScheme}-${width}.png`;
      const dir = process.env["FONT_SCREENSHOT_DIR"];
      await page.screenshot({ path: dir === undefined ? testInfo.outputPath(filename) : join(dir, filename) });
    });
  }
}
