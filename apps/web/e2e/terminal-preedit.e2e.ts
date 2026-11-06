import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

// A syllable an input method is composing is drawn as Ghostty draws a preedit: as cells at the cursor, a wide one over
// two cells at the size its committed glyph has, underlined, with no cursor drawn meanwhile (#674).
test.use({ serviceWorkers: "block" });

const GA = "\u{AC01}";

/** The committed wide glyphs of the input line and the preedit drawn after them, as painted. */
const painted = (element: HTMLElement) => {
  const cell = Number.parseFloat(getComputedStyle(element).getPropertyValue("--term-cell-width"));
  const host = element.getBoundingClientRect();
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- evaluate sends this function as source, so its helpers live inside it
  const advance = (node: Element) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().width;
  };
  const committed = [...element.querySelectorAll(".term-row:not(.term-preedit) .term-wide")].at(-1);
  const preedit = element.querySelector(".term-preedit");
  const glyph = preedit?.querySelector(".term-wide");
  const cursor = element.querySelector(".term-cursor");
  const input = element.querySelector("textarea");
  return {
    cell,
    committed:
      committed === undefined ? null : { advance: advance(committed), fontSize: getComputedStyle(committed).fontSize },
    preedit:
      preedit === null || glyph === null || glyph === undefined
        ? null
        : {
            text: preedit.textContent,
            col: Math.round((preedit.getBoundingClientRect().left - host.left) / cell),
            advance: advance(glyph),
            width: glyph.getBoundingClientRect().width,
            fontSize: getComputedStyle(glyph).fontSize,
            underline: getComputedStyle(preedit).textDecorationLine,
          },
    cursor:
      cursor === null
        ? null
        : {
            col: Math.round((cursor.getBoundingClientRect().left - host.left) / cell),
            outline: getComputedStyle(cursor).outlineColor,
          },
    inputOpacity: input === null ? null : getComputedStyle(input).opacity,
  };
};

async function compose(page: Page, terminal: Locator): Promise<CDPSession> {
  await terminal.getByRole("textbox").focus();
  await page.keyboard.type("echo ");
  await page.keyboard.insertText("\u{D55C}");
  await expect(terminal.locator(".term-row .term-wide").filter({ hasText: "\u{D55C}" })).not.toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: GA, selectionStart: 1, selectionEnd: 1 });
  return cdp;
}

test("a composing syllable is drawn as cells at the cursor, sized as its committed glyph, underlined (#674)", async ({
  page,
}) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  const before = await terminal.evaluate((element) => {
    const cell = Number.parseFloat(getComputedStyle(element).getPropertyValue("--term-cell-width"));
    return { cell };
  });
  const cdp = await compose(page, terminal);
  await expect(terminal.locator(".term-preedit")).toHaveText(GA);
  const shown = await terminal.evaluate(painted);
  console.log(`preedit: ${JSON.stringify(shown)}`);
  expect(shown.committed).not.toBeNull();
  expect(shown.preedit).not.toBeNull();
  // "$ echo 한" puts the cursor at column 9: the preedit starts there and fills two cells.
  expect(shown.preedit?.col).toBe(9);
  expect(shown.preedit?.width).toBeCloseTo(2 * before.cell, 0);
  expect(shown.preedit?.fontSize).toBe(shown.committed?.fontSize);
  expect(Math.abs((shown.preedit?.advance ?? 0) - (shown.committed?.advance ?? 0))).toBeLessThan(1);
  expect(shown.preedit?.underline).toBe("underline");
  expect(shown.inputOpacity).toBe("0");
  // No cursor is drawn while a preedit is.
  expect(shown.cursor === null || shown.cursor.outline === "rgba(0, 0, 0, 0)").toBe(true);

  await cdp.send("Input.insertText", { text: GA });
  await expect(terminal.locator(".term-preedit")).toHaveCount(0);
  await expect(terminal.locator(".term-row .term-wide").filter({ hasText: GA })).not.toHaveCount(0);
});
