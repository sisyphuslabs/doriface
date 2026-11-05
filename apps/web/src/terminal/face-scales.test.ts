import { describe, expect, test } from "bun:test";
import { FaceScales, faceScalesFor, forgetMeasuredFaces, type Measure } from "./face-scales.ts";

const ASCII_INK = {
  actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: 9,
  actualBoundingBoxAscent: 15,
  actualBoundingBoxDescent: 3.2,
};

/**
 * A terminal at 17.33 px whose default stack falls back to a CJK face drawing every full-width glyph 15 px wide (Apple SD
 * Gothic Neo at 13pt), and a user font "Own CJK" that draws Hangul itself, 16 px wide. Counts every measurement.
 */
function fakeCanvas(): { readonly measure: Measure; readonly calls: () => number } {
  let calls = 0;
  const measure: Measure = (text, family, scale) => {
    calls += 1;
    if ((text.codePointAt(0) ?? 0) < 0x80) return { width: 10.4 * scale, ...ASCII_INK };
    const own = family.startsWith('"Own CJK"') && text >= "\u{AC00}" && text <= "\u{D7A3}";
    const width = (own ? 16 : 15) * scale;
    return {
      width,
      actualBoundingBoxLeft: own ? -1 : 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: 14,
      actualBoundingBoxDescent: 2,
    };
  };
  return { measure, calls: () => calls };
}

const DEFAULT = '"JetBrains Mono Variable", monospace';

const measureFor = () => fakeCanvas().measure;

describe("faceScalesFor", () => {
  test("one font at one size is measured once, by every caller", () => {
    forgetMeasuredFaces();
    expect(faceScalesFor(17.33, DEFAULT, DEFAULT, measureFor)).toBe(faceScalesFor(17.33, DEFAULT, DEFAULT, measureFor));
  });

  test("another size is another set of measurements, never the scales of the first", () => {
    forgetMeasuredFaces();
    expect(faceScalesFor(30.67, DEFAULT, DEFAULT, measureFor)).not.toBe(
      faceScalesFor(17.33, DEFAULT, DEFAULT, measureFor),
    );
  });

  test("another font stack is another set of measurements", () => {
    forgetMeasuredFaces();
    const own = faceScalesFor(17.33, `"Own CJK", ${DEFAULT}`, DEFAULT, measureFor);
    expect(own).not.toBe(faceScalesFor(17.33, DEFAULT, DEFAULT, measureFor));
  });

  test("forgetting the measurements, as a finished font load does, measures again", () => {
    forgetMeasuredFaces();
    const before = faceScalesFor(17.33, DEFAULT, DEFAULT, measureFor);
    forgetMeasuredFaces();
    expect(faceScalesFor(17.33, DEFAULT, DEFAULT, measureFor)).not.toBe(before);
  });
});

describe("FaceScales", () => {
  test("a fallback face is sized to the primary's ideograph width, the same for every glyph of a block", () => {
    const scales = new FaceScales(fakeCanvas().measure, DEFAULT, DEFAULT);
    const hangul = scales.scaleOf("\u{D55C}");
    expect(15 * hangul).toBeCloseTo(18.2, 2);
    expect(scales.scaleOf("\u{AE00}")).toBe(hangul);
    expect(15 * scales.scaleOf("\u{6F22}")).toBeCloseTo(18.2, 2);
  });

  test("canvas measuring does not grow with the number of distinct glyphs drawn", () => {
    const canvas = fakeCanvas();
    const scales = new FaceScales(canvas.measure, DEFAULT, DEFAULT);
    for (let code = 0xac00; code < 0xac00 + 3000; code++) scales.scaleOf(String.fromCodePoint(code));
    for (let code = 0x4e00; code < 0x4e00 + 1000; code++) scales.scaleOf(String.fromCodePoint(code));
    const afterMany = canvas.calls();
    // The ASCII metrics once, then a few per block (Hangul, Han).
    expect(afterMany).toBeLessThan(120);
    for (let code = 0xb000; code < 0xb000 + 2000; code++) scales.scaleOf(String.fromCodePoint(code));
    expect(canvas.calls()).toBe(afterMany);
  });

  test("a user-chosen font that draws Hangul itself keeps its size, while ideographs it lacks are still sized", () => {
    const scales = new FaceScales(fakeCanvas().measure, `"Own CJK", ${DEFAULT}`, DEFAULT);
    expect(scales.scaleOf("\u{D55C}")).toBe(1);
    expect(scales.scaleOf("\u{6F22}")).not.toBe(1);
  });

  test("a narrow CJK bracket takes its face's scale, as Ghostty sizes the whole face", () => {
    const scales = new FaceScales(fakeCanvas().measure, DEFAULT, DEFAULT);
    expect(scales.scaleOf("\u{300C}")).toBe(scales.scaleOf("\u{6C34}"));
  });

  test.each([
    ["an emoji", "\u{1F600}"],
    ["an emoji inside a CJK block", "\u{3297}\u{FE0F}"],
    ["a wide glyph outside the CJK blocks", "\u{A000}"],
  ])("%s keeps its size without any canvas work", (_what, text) => {
    const canvas = fakeCanvas();
    expect(new FaceScales(canvas.measure, DEFAULT, DEFAULT).scaleOf(text)).toBe(1);
    expect(canvas.calls()).toBe(0);
  });
});
