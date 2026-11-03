import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

test("a wide glyph is centred in its two cells", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  // U+AC00, typed as UTF-8 octal so the keyboard input stays ASCII.
  await page.keyboard.type("printf 'w\\352\\260\\200w\\n'");
  await page.keyboard.press("Enter");
  const wide = terminal.locator(".term-row:not(.term-scrollback-row) .term-wide").filter({ hasText: "\u{AC00}" });
  await expect(wide).toHaveCount(1, { timeout: 15_000 });
  const margins = await wide.evaluate((span) => {
    const box = span.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(span);
    const glyph = range.getBoundingClientRect();
    return { left: glyph.left - box.left, right: box.right - glyph.right };
  });
  expect(Math.abs(margins.left - margins.right)).toBeLessThan(1);
});

/** WCAG relative luminance of a computed `rgb(...)` colour. */
function luminance(css: string): number {
  const channels = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const [r = 0, g = 0, b = 0] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("IME preedit text is dark on a light field, legible on the browser's composition highlight", async ({
      page,
    }) => {
      await page.goto("/");
      const terminal = await openNewTerminal(page);
      await terminal.getByRole("textbox").focus();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", { text: "\u{D55C}", selectionStart: 1, selectionEnd: 1 });
      const preedit = terminal.getByRole("textbox");
      await expect(preedit).toHaveValue("\u{D55C}");
      const colors = await preedit.evaluate((field) => {
        const style = getComputedStyle(field);
        return { text: style.color, field: style.backgroundColor };
      });
      const text = luminance(colors.text);
      const field = luminance(colors.field);
      expect(text).toBeLessThan(field);
      expect((field + 0.05) / (text + 0.05)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
