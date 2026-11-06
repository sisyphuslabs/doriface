import { expect, openNewTerminal, test } from "./fixtures.ts";

// The service worker reloads the page once it takes control; only pwa.e2e.ts tests it.
test.use({ serviceWorkers: "block" });

const HANGUL_FAMILIES = [
  "Noto Sans Mono CJK KR",
  "Noto Sans Mono CJK JP",
  "Noto Sans CJK KR",
  "Noto Sans KR",
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

/**
 * The reported failure is a cell that paints nothing, so the test compares the same cell's pixels before and after the
 * syllable is printed: an advance width cannot answer this (a codepoint with no glyph still reports one), and a canvas
 * cannot either (a browser paints a tofu box for a missing glyph, which is ink). Only the rendered cell separates a
 * drawn syllable from the blank space in #959.
 */
async function printsInk(
  page: import("@playwright/test").Page,
  terminal: import("@playwright/test").Locator,
): Promise<boolean> {
  await terminal.getByRole("textbox").focus();
  const octal = [...new TextEncoder().encode("안")].map((byte) => `\\${byte.toString(8)}`).join("");
  await page.keyboard.type(`printf '${octal}\\n'`);
  await page.keyboard.press("Enter");
  const wide = terminal.locator(".term-row:not(.term-scrollback-row) .term-wide").filter({ hasText: "안" }).first();
  await expect(wide).toBeVisible({ timeout: 15_000 });

  const glyph = await wide.screenshot();
  const box = await wide.boundingBox();
  const bounds = await terminal.boundingBox();
  if (box === null || bounds === null) throw new Error("the syllable's cell has no box");
  const beyond = box.x + box.width * 2;
  const blank = await page.screenshot({
    clip: {
      x: Math.min(beyond, bounds.x + bounds.width - box.width),
      y: box.y,
      width: box.width,
      height: box.height,
    },
  });
  console.log(
    "DBG box",
    JSON.stringify(box),
    "glyphBytes",
    glyph.length,
    "blankBytes",
    blank.length,
    "equal",
    glyph.equals(blank),
  );
  return glyph.length > 0 && !glyph.equals(blank);
}

test("Hangul typed into a terminal paints its cell, two cells wide (#959)", async ({ page }) => {
  await page.goto("/");
  const terminal = await openNewTerminal(page);
  expect(await printsInk(page, terminal)).toBe(true);

  const ratio = await page.evaluate(() => {
    const terminalElement = document.querySelector("[data-terminal]");
    if (terminalElement === null) throw new Error("the terminal is not on the page");
    const style = getComputedStyle(terminalElement);
    const cell = Number.parseFloat(style.getPropertyValue("--term-cell-width"));
    if (!(cell > 0)) throw new Error("the terminal does not publish its cell width");
    return cell;
  });
  const wideBox = await terminal
    .locator(".term-row:not(.term-scrollback-row) .term-wide")
    .filter({ hasText: "안" })
    .first()
    .boundingBox();
  if (wideBox === null) throw new Error("the syllable's cell has no box");
  expect(wideBox.width / ratio).toBeGreaterThan(1.5);
});

test.describe("the reporter's Android PWA", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 800, height: 1280 },
  });

  test("an Android tablet keeps a Hangul face and draws the syllable (#959)", async ({ page }) => {
    await page.goto("/");

    const stack = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-term"));
    expect(HANGUL_FAMILIES.filter((family) => stack.includes(family))).not.toHaveLength(0);

    const terminal = await openNewTerminal(page);
    await terminal.getByRole("textbox").focus();
    const octal = [...new TextEncoder().encode("안")].map((byte) => `\\${byte.toString(8)}`).join("");
    await page.keyboard.type(`printf '${octal}\\n'`);
    await page.keyboard.press("Enter");
    const wide = terminal.locator(".term-wide").filter({ hasText: "안" }).first();
    await expect(wide).toBeVisible({ timeout: 15_000 });
    const box = await wide.boundingBox();
    if (box === null) throw new Error("the syllable's cell has no box");
    expect(box.width).toBeGreaterThan(0);
  });
});
