/** The terminal font's metrics a wide glyph is sized against, in CSS pixels. */
export interface PrimaryMetrics {
  /** One cell: the advance of an ASCII glyph. */
  readonly cell: number;
}

/** Rounded down, so the style string stays stable and never asks for more than was measured. */
const rounded = (scale: number): number => Math.floor(scale * 10_000) / 10_000;

/**
 * The font-size factor that gives a fallback face's wide glyphs the advance Ghostty gives them in their two cells;
 * `advanceAt(scale)` is the advance of a full-width sample glyph of that face at `scale` times the terminal's size.
 *
 * The grid owns the two-cell advance. Capping it by the Latin font's ink height makes Korean narrow even after its
 * fallback face is correctly identified (#410). A full-width sample sizes the whole fallback face to that advance.
 * A sample that already fills its cells, or is no wider than one cell (a missing glyph), keeps its size.
 *
 * A browser that rounds advances to whole pixels (Chromium on Linux) can draw the scaled glyph wider than the target,
 * past its cells, so the factor shrinks until the advance it actually draws fits.
 */
export function wideGlyphScale(advanceAt: (scale: number) => number, primary: PrimaryMetrics): number {
  const advance = advanceAt(1);
  const cells = 2 * primary.cell;
  if (!(advance > primary.cell) || (advance <= cells && cells - advance < 0.5)) return 1;
  const scale = rounded(cells / advance);
  if (advanceAt(scale) <= cells) return scale;
  // Proportional corrections can remain on the same rounded-up pixel for many iterations. Search the monotonic
  // advance instead; 16 steps resolve better than the four decimal places retained in the CSS factor.
  let low = 0;
  let high = scale;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (advanceAt(middle) <= cells) low = middle;
    else high = middle;
  }
  return rounded(low);
}

type AdvanceMetrics = Pick<TextMetrics, "width">;

export function primaryMetrics(context: { measureText(text: string): AdvanceMetrics }): PrimaryMetrics {
  return { cell: context.measureText("W").width };
}
