import { describe, expect, test } from "bun:test";
import { primaryMetrics, wideGlyphScale } from "./wide-glyph.ts";

// A 10.40625 px cell owns a 20.8125 px wide advance, independently of the ASCII ink height.
const jetbrains = { cell: 10.406_25 };

/** A face whose advance grows with its size, as a browser lays it out with subpixel advances. */
const linear = (advance: number) => (scale: number) => advance * scale;

// Chromium on Linux: 10 px cells, ASCII ink 20 px, NanumGothic Hangul 16 px; at 1.25x it draws 21 px, not 20.
const whole = (scale: number) => Math.ceil(16 * scale + 0.4);

describe("wideGlyphScale", () => {
  test("a fallback face narrower than the cells grows to the primary's ideograph width, as Ghostty sizes it", () => {
    // Apple SD Gothic Neo draws Hangul with a 15 px advance at that size.
    expect(15 * wideGlyphScale(linear(15), jetbrains)).toBeCloseTo(20.8125, 2);
  });

  test("the ideograph width follows two primary cells", () => {
    const tall = { cell: 8 };
    expect(17 * wideGlyphScale(linear(17), tall)).toBeCloseTo(16, 2);
  });

  test("a fallback face wider than the primary's ideograph width shrinks to it", () => {
    expect(23 * wideGlyphScale(linear(23), jetbrains)).toBeCloseTo(20.8125, 2);
  });

  test("where advances round up to whole pixels, the glyph is shrunk until the advance drawn fits the cells", () => {
    const scale = wideGlyphScale(whole, { cell: 10 });
    expect(whole(scale)).toBe(20);
  });

  test("whole-pixel advances fit a fractional two-cell boundary without stopping on a rounded-up pixel", () => {
    const scale = wideGlyphScale(whole, { cell: 10.43 });
    expect(whole(scale)).toBe(20);
  });

  test.each([
    ["fills its two cells (a font made for the grid)", 20.8125],
    ["is within half a pixel of two cells", 20.5],
    ["is no wider than one cell", 10],
    ["has no advance", 0],
    ["has an advance that is not a number", Number.NaN],
  ])("a glyph that %s keeps its size", (_why, advance) => {
    expect(wideGlyphScale(linear(advance), jetbrains)).toBe(1);
  });
});

describe("primaryMetrics", () => {
  test("the cell is the primary W's advance, regardless of other glyphs' ink heights", () => {
    const ink: Record<string, { ascent: number; descent: number }> = {
      W: { ascent: 10, descent: 0 },
      j: { ascent: 9, descent: 4 },
    };
    const context = {
      measureText: (text: string) => {
        const glyph = ink[text] ?? { ascent: 12, descent: 1 };
        return {
          width: text === "W" ? 9.5 : 7,
          actualBoundingBoxAscent: glyph.ascent,
          actualBoundingBoxDescent: glyph.descent,
        };
      },
    };
    expect(primaryMetrics(context)).toEqual({ cell: 9.5 });
  });
});
