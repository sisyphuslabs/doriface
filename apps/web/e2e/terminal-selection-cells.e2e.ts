import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { expect, openNewTerminal, test } from "./fixtures.ts";

test.use({ serviceWorkers: "block", viewport: { width: 1200, height: 700 } });

/** A Korean face of its own, so the line's Hangul is drawn by a fallback face whatever the host has installed. */
const HANGUL_FONT = readFileSync(new URL("./fonts/e2e-hangul.otf", import.meta.url)).toString("base64");
const MAGENTA = [255, 0, 255] as const;

/** RGB of every pixel of an 8-bit RGB or RGBA, non-interlaced PNG, as Playwright writes screenshots. */
function decodePng(png: Buffer): { width: number; height: number; at: (x: number, y: number) => number[] } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      const paeth = (): number => {
        const p = left + up - upLeft;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return a <= b && a <= c ? left : b <= c ? up : upLeft;
      };
      const predicted = [0, left, up, (left + up) >> 1, paeth()][filter] ?? 0;
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const at = (x: number, y: number): number[] => [
    ...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3),
  ];
  return { width, height, at };
}

const isMagenta = (rgb: readonly number[]): boolean =>
  rgb.every((value, index) => Math.abs(value - (MAGENTA[index] ?? 0)) <= 12);

/**
 * The Korean fallback face, and a magenta selection set as a configured selection-background is (render-css.ts): the
 * browser highlight's colour and the --term-selection-bg the app paints with, so only where it paints can differ.
 */
async function useHangulFallbackAndMagentaSelection(page: Page): Promise<void> {
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-term").trim(),
  );
  const [first, ...rest] = primary.split(",");
  await page.addStyleTag({
    content: [
      '@font-face { font-family: "E2E Hangul"; src: url(data:font/otf;base64,' +
        HANGUL_FONT +
        ') format("opentype"); }',
      ":root .wterm.wterm.wterm.wterm { --term-font-family: " +
        [first, '"E2E Hangul"', ...rest].join(",") +
        " !important;",
      "  --term-selection-bg: rgb(255 0 255) !important; }",
      ":root .wterm.wterm.wterm ::selection { background: rgb(255 0 255); }",
    ].join("\n"),
  });
  await page.evaluate(() => document.fonts.load('16px "E2E Hangul"', "\uAC00"));
}

/** Selects from the second character of the line's first text to the end of its last Hangul syllable. */
async function selectAcross(row: Locator): Promise<string> {
  return row.evaluate((element) => {
    const texts = [...element.querySelectorAll("span")].flatMap((span) =>
      [...span.childNodes].filter((node): node is Text => node.nodeType === Node.TEXT_NODE),
    );
    const first = texts.find((text) => text.data.startsWith("ab"));
    const last = texts.find((text) => text.data === "\uAE00");
    if (first === undefined || last === undefined) throw new Error("the line's text is not where it was printed");
    const range = document.createRange();
    range.setStart(first, 1);
    range.setEnd(last, last.data.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
}

// Ghostty paints a selection over whole cells: each wide character is its two cells, and nothing spills past the row,
// whatever face draws the glyph (#410). The browser's own highlight follows each glyph's box instead.
test("a selection over a mixed Korean and ASCII line paints exactly its cells, contiguous, within the row", async ({
  page,
}) => {
  await page.goto("/");
  await useHangulFallbackAndMagentaSelection(page);
  const terminal = await openNewTerminal(page);
  await terminal.getByRole("textbox").focus();
  // ab 가나다 cd 한글 ef: Hangul at columns 3-8 and 13-16, two cells each.
  await page.keyboard.type(
    String.raw`printf 'ab \352\260\200\353\202\230\353\213\244 cd \355\225\234\352\270\200 ef\n'`,
  );
  await page.keyboard.press("Enter");
  const row = terminal.locator(".term-row").filter({ hasText: "ef" }).filter({ hasNotText: "printf" }).first();
  await expect(row.locator(".term-wide")).toHaveCount(5);

  expect(await selectAcross(row)).toBe("b \uAC00\uB098\uB2E4 cd \uD55C\uAE00");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const cell = await terminal.evaluate((element) =>
    parseFloat(getComputedStyle(element.closest(".wterm") ?? element).getPropertyValue("--term-cell-width")),
  );
  const box = await row.boundingBox();
  if (box === null) throw new Error("the row has no box");
  const margin = 4;
  const clip = {
    x: Math.floor(box.x),
    y: Math.floor(box.y) - margin,
    width: Math.ceil(20 * cell),
    height: Math.round(box.height) + 2 * margin,
  };
  const image = decodePng(await page.screenshot({ clip }));
  const top = margin;
  const bottom = margin + Math.round(box.height) - 1;
  // Columns 1 to 16 are selected: from the second character to the end of the last syllable.
  const [start, end] = [Math.round(1 * cell), Math.round(17 * cell)];
  const band = (y: number): boolean[] => Array.from({ length: image.width }, (_, x) => isMagenta(image.at(x, y)));

  for (const y of [top + 1, bottom - 1]) {
    const painted = band(y);
    // Every pixel across the selected cells, one run; none before or after them (a pixel of rounding at each edge).
    expect(
      painted.slice(start + 1, end - 1).every(Boolean),
      "row y=" + y + " is painted across the selected cells",
    ).toBe(true);
    expect(painted.slice(0, start - 1).some(Boolean), "row y=" + y + " is painted before the selection").toBe(false);
    expect(painted.slice(end + 1).some(Boolean), "row y=" + y + " is painted after the selection").toBe(false);
  }
  for (const y of [top - 3, top - 2, top - 1, bottom + 1, bottom + 2, bottom + 3]) {
    expect(band(y).some(Boolean), "the selection spills to y=" + (y - top) + " outside its row").toBe(false);
  }
});
