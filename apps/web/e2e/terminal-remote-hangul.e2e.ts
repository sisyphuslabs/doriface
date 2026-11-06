import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";
import { MACHINE_NAME } from "./machine.ts";
import { machineConnected } from "./sidebar-seed.ts";
import { newOn, reconnect } from "./machine-switch.ts";

// #647: the two Hangul defects in one place, on the path the report showed them on — a space on another machine, not
// the local one. A terminal there that was not drawn when its font was first measured must paint every syllable
// (#645), and each must be drawn at Ghostty's ideograph width rather than stretched over the whole two cells (#647).
test.use({ serviceWorkers: "block" });

const SYLLABLE = /^[\u{AC00}-\u{D7A3}]$/u;
const LINE = "\u{C548}\u{B155}\u{D558}\u{C138}\u{C694} \u{D55C}\u{AE00} doriface";

async function print(page: Page, terminal: Locator, text: string): Promise<void> {
  const octal = [...new TextEncoder().encode(text)].map((byte) => `\\${byte.toString(8)}`).join("");
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`printf '${octal}\\n'`);
  await page.keyboard.press("Enter");
}

interface Extent {
  readonly cell: number;
  readonly ideograph: number;
  readonly wide: readonly { readonly text: string; readonly advance: number }[];
}

/** Each wide glyph's advance against the grid it is fitted to: Ghostty's ideograph width, `min(asciiHeight, 2 cells)`. */
const extentOf = (element: HTMLElement): Extent => {
  const style = getComputedStyle(element);
  const cell = Number.parseFloat(style.getPropertyValue("--term-cell-width"));
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) throw new Error("no canvas");
  context.font = `${style.fontSize} ${style.fontFamily}`;
  let ascent = 0;
  let descent = 0;
  for (let code = 0x21; code < 0x7f; code++) {
    const ink = context.measureText(String.fromCharCode(code));
    ascent = Math.max(ascent, ink.actualBoundingBoxAscent);
    descent = Math.max(descent, ink.actualBoundingBoxDescent);
  }
  return {
    cell,
    ideograph: Math.min(ascent + descent, 2 * cell),
    wide: [...element.querySelectorAll(".term-row:not(.term-scrollback-row) .term-wide")].map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      return { text: span.textContent ?? "", advance: range.getBoundingClientRect().width };
    }),
  };
};

test("a terminal on another machine paints every Hangul syllable at its ideograph width after its tab was hidden", async ({
  page,
}) => {
  test.setTimeout(180_000);
  reconnect();
  await machineConnected(MACHINE_NAME);
  await page.goto("/");
  await newOn(page).click({ force: true });
  const remote = page.locator(`[data-terminal^="${MACHINE_NAME}/"]`).first();
  await expect(remote).toContainText("$", { timeout: 30_000 });

  // A second terminal in the same space, then a reload: the saved layout restores both tabs with the first one hidden,
  // so its font is first measured with no layout at all.
  await openNewTerminal(page);
  await page.reload();
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  await expect(tabs.first()).toBeVisible({ timeout: 20_000 });
  await tabs.first().click();
  const first = page.locator(`[data-terminal^="${MACHINE_NAME}/"]`).first();
  await expect(first).toBeVisible({ timeout: 20_000 });

  await print(page, first, LINE);
  const syllables = first.locator(".term-row:not(.term-scrollback-row) .term-wide").filter({ hasText: SYLLABLE });
  await expect(syllables).toHaveCount(7, { timeout: 30_000 });
  const extent = await first.evaluate(extentOf);
  console.log(`remote wide extent: ${JSON.stringify(extent)}`);
  for (const glyph of extent.wide)
    expect
      .soft(glyph.advance, `${glyph.text}: painted, at the ideograph width rather than nothing or the whole two cells`)
      .toBeGreaterThan(extent.ideograph - 1.5);
  for (const glyph of extent.wide)
    expect
      .soft(glyph.advance, `${glyph.text}: never stretched past the ideograph width`)
      .toBeLessThanOrEqual(extent.ideograph + 1);
});
