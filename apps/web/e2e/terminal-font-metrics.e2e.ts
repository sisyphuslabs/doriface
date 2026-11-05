import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { loadFixtureFont } from "./font-fixture.ts";

test.use({ serviceWorkers: "block" });

async function configure(page: Page, families: readonly string[]): Promise<Locator> {
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page
    .getByRole("tab", { name: "Terminal", exact: true })
    .or(page.getByRole("button", { name: "Terminal", exact: true }))
    .first()
    .click();
  await page.getByRole("textbox", { name: "font-size", exact: true }).fill("16");
  await page.keyboard.press("Enter");
  for (const family of families) {
    // oxlint-disable-next-line no-await-in-loop -- repeated font-family entries preserve their order
    await page.getByRole("button", { name: "Add font-family", exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- the next field exists only after this one commits
    await page.keyboard.type(family);
    // oxlint-disable-next-line no-await-in-loop -- commits this family
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Close settings" }).first().click();
  const terminal = page.locator('[data-focused="true"] [data-terminal]');
  await expect(terminal).toContainText("$");
  return terminal;
}

for (const dpr of [1, 2, 1.5]) {
  test(`16 Ghostty points use native macOS glyph and cell metrics at DPR ${dpr}, and zoom applies live`, async ({
    page,
  }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "MacIntel" }));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: dpr,
      mobile: false,
    });
    await page.goto("/");
    await loadFixtureFont(page);
    await openNewTerminal(page);
    const terminal = await configure(page, ["Terminal PUA Fixture"]);
    const geometry = () =>
      terminal.evaluate((element) => {
        const style = getComputedStyle(element);
        const row = element.querySelector(".term-row");
        const context = document.createElement("canvas").getContext("2d");
        if (context === null) throw new Error("No canvas");
        context.font = `${style.fontSize} ${style.fontFamily}`;
        const ink = context.measureText("W");
        return {
          size: parseFloat(style.fontSize),
          height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
          cell: parseFloat(style.getPropertyValue("--term-cell-width")),
          row: row?.getBoundingClientRect().height,
        };
      });
    // Independent font design metrics: 900/1000 advance, 800/1000 ink height, 1000/1000 line height.
    await expect.poll(async () => (await geometry()).size).toBe(16);
    const measured = await geometry();
    expect(measured.height).toBeCloseTo(16 * 0.8, 4);
    // Layout uses 1/64 CSS-pixel units after the native device-pixel rounding.
    expect(measured.cell).toBe(Math.round((Math.round(16 * 0.9 * dpr) / dpr) * 64) / 64);
    expect(measured.row).toBe(16);
    const mounted = await terminal.elementHandle();
    await terminal.getByRole("textbox").focus();
    await page.keyboard.press("ControlOrMeta+Equal");
    await expect.poll(async () => (await geometry()).size).toBe(17);
    expect(await mounted?.evaluate((element) => element.isConnected)).toBe(true);
  });
}

test("quoted configured families draw BMP and supplementary PUA glyphs through the font list (#387)", async ({
  page,
}) => {
  await page.goto("/");
  await loadFixtureFont(page);
  await openNewTerminal(page);
  const terminal = await configure(page, ["Missing terminal test font", "'Terminal PUA Fixture'"]);
  const icons = "\ue0b0\uf015\uf07b\u{f0001}";
  const octal = [...new TextEncoder().encode(icons)].map((byte) => `\\${byte.toString(8)}`).join("");
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`printf '${octal}\\n'`);
  await page.keyboard.press("Enter");
  const spans = terminal
    .locator(".term-row:not(.term-scrollback-row) span")
    .filter({ hasText: /^[\ue0b0\uf015\uf07b\u{f0001}]$/u });
  await expect(spans).toHaveCount(4);
  const advances = await spans.evaluateAll((nodes) =>
    nodes.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const style = getComputedStyle(node);
      const spacing = style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing);
      return (range.getBoundingClientRect().width - spacing) / parseFloat(style.fontSize);
    }),
  );
  // The fixture's triangle has a 0.9 em advance; a fallback/tofu face has a different advance.
  for (const advance of advances) expect(advance).toBeCloseTo(0.9, 2);
});
