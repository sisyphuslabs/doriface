import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const HANGUL_FAMILIES = [
  "Noto Sans Mono CJK KR",
  "Noto Sans Mono CJK JP",
  "Noto Sans CJK KR",
  "Nanum Gothic Coding",
  "Malgun Gothic",
  "Apple SD Gothic Neo",
];

test("the terminal font stack names a Hangul face, so a device without the Latin ones still draws Korean (#959)", async ({
  page,
}) => {
  await page.goto("/");
  await openNewTerminal(page);
  const stack = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-term"));
  expect(HANGUL_FAMILIES.filter((family) => stack.includes(family))).not.toHaveLength(0);
});

test("Hangul typed into a terminal draws ink two cells wide, from the page's own stack (#959)", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  const octal = [...new TextEncoder().encode("안녕하세요")].map((byte) => `\\${byte.toString(8)}`).join("");
  await page.keyboard.type(`printf '${octal}\\n'`);
  await page.keyboard.press("Enter");

  const wide = terminal.locator(".term-row:not(.term-scrollback-row) .term-wide").filter({ hasText: "안" }).first();
  await expect(wide).toBeVisible({ timeout: 15_000 });

  const drawn = await wide.evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const font = getComputedStyle(span);
    const pen = document.createElement("canvas").getContext("2d");
    if (pen === null) throw new Error("measuring the cell needs a 2D canvas");
    pen.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
    return {
      text: span.textContent ?? "",
      ink: range.getBoundingClientRect().width,
      cell: pen.measureText("W").width,
      box: span.getBoundingClientRect().width,
    };
  });

  expect(drawn.text).toBe("안");
  // A cell with no glyph for the codepoint lays out no ink: the blank space the report shows.
  expect(drawn.ink).toBeGreaterThan(0);
  expect(drawn.cell).toBeGreaterThan(0);
  // Ghostty draws a full-width syllable across two cells, not one.
  expect(drawn.box).toBeGreaterThan(drawn.cell * 1.5);
  expect(drawn.box).toBeLessThan(drawn.cell * 2.5);
});
