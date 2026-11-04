import { type PrimaryMetrics, primaryMetrics, wideGlyphScale } from "./wide-glyph.ts";

type GlyphMetrics = Pick<
  TextMetrics,
  "width" | "actualBoundingBoxLeft" | "actualBoundingBoxRight" | "actualBoundingBoxAscent" | "actualBoundingBoxDescent"
>;

/** `text`'s metrics in `family` at `scale` times the terminal's size. */
export type Measure = (text: string, family: string, scale: number) => GlyphMetrics;

/**
 * The script blocks of wide text, each with a full-width sample glyph. A CJK face draws a block at one advance, so the
 * sample's advance stands for every glyph of the block the browser draws from the same face.
 */
const BLOCKS: readonly (readonly [from: number, to: number, sample: string])[] = [
  [0x1100, 0x11ff, "\u{AC00}"],
  [0x3130, 0x318f, "\u{AC00}"],
  [0xa960, 0xa97f, "\u{AC00}"],
  [0xac00, 0xd7ff, "\u{AC00}"],
  [0x3040, 0x30ff, "\u{3042}"],
  [0x31f0, 0x31ff, "\u{3042}"],
  [0x2e80, 0x303f, "\u{6C34}"],
  [0x3100, 0x312f, "\u{6C34}"],
  [0x3190, 0x31ef, "\u{6C34}"],
  [0x3200, 0x9fff, "\u{6C34}"],
  [0xf900, 0xfaff, "\u{6C34}"],
  [0xfe30, 0xfe4f, "\u{6C34}"],
  [0xff00, 0xffef, "\u{6C34}"],
  [0x20000, 0x3ffff, "\u{6C34}"],
];

function blockSample(code: number): string | undefined {
  return BLOCKS.find(([from, to]) => code >= from && code <= to)?.[2];
}

/** Emoji keep their size: Ghostty fits them to the cells with their own rule, not the ideograph width. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F/u;

const INK = ["width", "actualBoundingBoxLeft", "actualBoundingBoxRight", "actualBoundingBoxAscent"] as const;
const sameGlyph = (a: GlyphMetrics, b: GlyphMetrics): boolean => INK.every((key) => Math.abs(a[key] - b[key]) < 0.01);

/**
 * The wide-glyph scales of one terminal font at one size. Ghostty sizes each fallback face, not each glyph, so each
 * script block is measured once, from its sample, the first time one of its glyphs is drawn; after that a glyph's scale
 * is a range lookup with no canvas work.
 */
export class FaceScales {
  readonly #measure: Measure;
  readonly #family: string;
  readonly #defaultFamily: string;
  readonly #scales = new Map<string, number>();
  #primary: PrimaryMetrics | undefined;

  /** `family` is the terminal's font stack; `defaultFamily` is the stack without the families the user chose. */
  constructor(measure: Measure, family: string, defaultFamily: string) {
    this.#measure = measure;
    this.#family = family;
    this.#defaultFamily = defaultFamily;
  }

  scaleOf(text: string): number {
    const sample = blockSample(text.codePointAt(0) ?? 0);
    if (sample === undefined || EMOJI.test(text)) return 1;
    let scale = this.#scales.get(sample);
    if (scale === undefined) {
      scale = this.#faceScale(sample);
      this.#scales.set(sample, scale);
    }
    return scale;
  }

  #faceScale(sample: string): number {
    const drawn = this.#measure(sample, this.#family, 1);
    // The user's chosen font drew the sample when it differs from what the default stack falls back to; like Ghostty,
    // only a fallback face is resized.
    if (this.#family !== this.#defaultFamily && !sameGlyph(drawn, this.#measure(sample, this.#defaultFamily, 1)))
      return 1;
    this.#primary ??= primaryMetrics({ measureText: (text) => this.#measure(text, this.#family, 1) });
    return wideGlyphScale(
      (at) => (at === 1 ? drawn.width : this.#measure(sample, this.#family, at).width),
      this.#primary,
    );
  }
}

/** One FaceScales per font and size, shared by every terminal view, so a new view or a new scaler measures nothing. */
const faces = new Map<string, FaceScales>();

/** Drops every measurement: a web font that finished loading changes the metrics behind the same font string. */
export function forgetMeasuredFaces(): void {
  faces.clear();
}

// Here, not in each terminal view: the cache outlives the views, and a font can finish loading while none is mounted.
if (typeof document !== "undefined") document.fonts.addEventListener("loadingdone", forgetMeasuredFaces);

/**
 * The FaceScales for a font stack at a size in px, made the first time that font and size is asked for, with the
 * measure `measureFor(size)` returns. Null when there is nothing to measure with.
 */
export function faceScalesFor(
  size: number,
  family: string,
  defaultFamily: string,
  measureFor: (size: number) => Measure | null,
): FaceScales | null {
  const key = `${size}px ${family} | ${defaultFamily}`;
  const known = faces.get(key);
  if (known !== undefined) return known;
  const measure = measureFor(size);
  if (measure === null) return null;
  const made = new FaceScales(measure, family, defaultFamily);
  faces.set(key, made);
  return made;
}

/**
 * The scale for each wide glyph of `element`'s terminal, in its computed font: the browser's own fallback picks the face,
 * so each face is measured, never assumed. Null when there is no canvas to measure with.
 */
export function wideGlyphScaler(element: HTMLElement): ((text: string) => number) | null {
  const style = getComputedStyle(element);
  const family = style.fontFamily;
  const scales = faceScalesFor(
    parseFloat(style.fontSize),
    family,
    style.getPropertyValue("--font-term").trim() || family,
    (size) => {
      const context = element.ownerDocument.createElement("canvas").getContext("2d");
      if (context === null) return null;
      return (text, font, at) => {
        context.font = `${size * at}px ${font}`;
        return context.measureText(text);
      };
    },
  );
  return scales === null ? null : (text) => scales.scaleOf(text);
}
