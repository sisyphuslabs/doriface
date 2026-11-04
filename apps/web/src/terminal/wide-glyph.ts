/** The terminal font's metrics a wide glyph is sized against, in CSS pixels. */
export interface PrimaryMetrics {
  /** One cell: the advance of an ASCII glyph. */
  readonly cell: number;
  /** The height of the box around the ink of every printable ASCII glyph. */
  readonly asciiHeight: number;
}

/** Rounded down, so the style string stays stable and never asks for more than was measured. */
const rounded = (scale: number): number => Math.floor(scale * 10_000) / 10_000;

/**
 * The font-size factor that gives a wide glyph the advance Ghostty gives it in its two cells; `advanceAt(scale)` is the
 * glyph's advance with its font at `scale` times the terminal's size.
 *
 * Ghostty sizes every fallback face so its ideograph width matches the primary font's (`ic_width` in
 * src/font/Collection.zig); a primary without ideographs counts as min(ASCII height, two cells) (`icWidth` in
 * src/font/Metrics.zig). A full-width glyph's advance is its face's ideograph width, so sizing by the glyph's own advance
 * sizes the face the browser picked for it. A glyph that already fills its two cells comes from a font made for the
 * grid, and one no wider than a cell is not a full-width design: both keep their size.
 *
 * A browser that rounds advances to whole pixels (Chromium on Linux) can draw the scaled glyph wider than the target,
 * past its cells, so the factor shrinks until the advance it actually draws fits.
 */
export function wideGlyphScale(advanceAt: (scale: number) => number, primary: PrimaryMetrics): number {
  const advance = advanceAt(1);
  const cells = 2 * primary.cell;
  if (!(advance > primary.cell) || Math.abs(advance - cells) < 0.5) return 1;
  const target = Math.min(primary.asciiHeight, cells);
  let scale = rounded(target / advance);
  for (let step = 0; step < 4; step++) {
    const drawn = advanceAt(scale);
    if (drawn <= target + 0.01) break;
    scale = rounded((scale * target) / drawn);
  }
  return scale;
}

/** Emoji keep their size: Ghostty fits them to the cells with their own rule, not the ideograph width. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F/u;

type GlyphMetrics = Pick<TextMetrics, "width" | "actualBoundingBoxAscent" | "actualBoundingBoxDescent">;

export function primaryMetrics(context: { measureText(text: string): GlyphMetrics }): PrimaryMetrics {
  let ascent = 0;
  let descent = 0;
  for (let code = 0x21; code < 0x7f; code++) {
    const ink = context.measureText(String.fromCharCode(code));
    ascent = Math.max(ascent, ink.actualBoundingBoxAscent);
    descent = Math.max(descent, ink.actualBoundingBoxDescent);
  }
  return { cell: context.measureText("W").width, asciiHeight: ascent + descent };
}

/**
 * The scale for each wide glyph of `element`'s terminal, measured in its computed font: the browser's own fallback picks
 * the face, so the advance is measured, never assumed. Null when there is no canvas to measure with.
 */
export function wideGlyphScaler(element: HTMLElement): ((text: string) => number) | null {
  const context = element.ownerDocument.createElement("canvas").getContext("2d");
  if (context === null) return null;
  const style = getComputedStyle(element);
  const size = parseFloat(style.fontSize);
  context.font = `${size}px ${style.fontFamily}`;
  const primary = primaryMetrics(context);
  const scales = new Map<string, number>();
  return (text) => {
    if (EMOJI.test(text)) return 1;
    let scale = scales.get(text);
    if (scale === undefined) {
      scale = wideGlyphScale((at) => {
        context.font = `${size * at}px ${style.fontFamily}`;
        return context.measureText(text).width;
      }, primary);
      scales.set(text, scale);
    }
    return scale;
  };
}
