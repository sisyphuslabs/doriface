import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// A terminal that mounts while its tab is not shown has no layout to measure its font with. Its wide glyphs must still
// be drawn at the size that fills their two cells once the tab is shown (#645).
test.use({ serviceWorkers: "block" });

const LINE = "\u{BC30}\u{D3EC}\u{C7A1} \u{D655}\u{C778} doriface \u{D55C}\u{AE00}";

/** `text` typed as UTF-8 octal, so the keyboard input stays ASCII. */
const octalOf = (text: string): string =>
  [...new TextEncoder().encode(text)].map((byte) => `\\${byte.toString(8)}`).join("");

async function print(page: Page, terminal: Locator, text: string): Promise<void> {
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type(`printf '${octalOf(text)}\\n'`);
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".term-row").filter({ hasText: "doriface" })).not.toHaveCount(0, { timeout: 30_000 });
}

/** Each wide glyph of the printed line: the advance it paints against its two cells. */
const wideOf = (element: HTMLElement) => {
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
  const row = [...element.querySelectorAll(".term-row")].find((each) => (each.textContent ?? "").includes("doriface"));
  return {
    cell,
    asciiInk: ascent + descent,
    nativeCell: style.getPropertyValue("--term-native-cell-width").trim(),
    wide: [...(row?.querySelectorAll(".term-wide") ?? [])].map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      return { text: span.textContent ?? "", advance: range.getBoundingClientRect().width };
    }),
  };
};

test("a terminal restored into a tab that is not shown draws its wide glyphs once shown (#645)", async ({ page }) => {
  await page.goto("/");
  const first = await openNewTerminal(page);
  const address = await first.getAttribute("data-terminal");
  await openNewTerminal(page);
  // The saved layout brings both tabs back with the second one shown: the first mounts hidden.
  await page.reload();
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  await expect(tabs).toHaveCount(2, { timeout: 20_000 });
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  const hidden = page.locator(`[data-terminal="${address}"]`);
  await expect(hidden).toBeAttached({ timeout: 20_000 });
  await expect(hidden).toBeHidden();
  await tabs.nth(0).click();
  await expect(hidden).toBeVisible();
  await print(page, hidden, LINE);
  const measured = await hidden.evaluate(wideOf);
  console.log(`hidden-mount wide: ${JSON.stringify(measured)}`);
  expect(measured.wide.length).toBe(7);
  const ideograph = Math.min(measured.asciiInk, 2 * measured.cell);
  for (const glyph of measured.wide) {
    expect.soft(glyph.advance, `${glyph.text}: drawn, filling its ideograph width`).toBeGreaterThan(ideograph - 1.5);
  }
});
