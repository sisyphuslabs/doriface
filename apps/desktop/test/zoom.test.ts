import { describe, expect, test } from "bun:test";
import { nextZoomFactor, savedZoomFactor } from "../src/config/zoom.ts";

describe("window zoom steps", () => {
  test("zooming out and back in walks Chromium's steps and stops at the ends", () => {
    const out: number[] = [];
    for (let factor = 1, i = 0; i < 7; i += 1) out.push((factor = nextZoomFactor(factor, "out")));
    expect(out).toEqual([0.9, 0.8, 0.75, 0.67, 0.5, 0.5, 0.5]);
    const back: number[] = [];
    for (let factor = 0.5, i = 0; i < 12; i += 1) back.push((factor = nextZoomFactor(factor, "in")));
    expect(back).toEqual([0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2, 2]);
    expect(nextZoomFactor(1.75, "reset")).toBe(1);
  });

  test("a zoom between two steps moves to the next step in the direction pressed", () => {
    expect(nextZoomFactor(0.85, "out")).toBe(0.8);
    expect(nextZoomFactor(0.85, "in")).toBe(0.9);
  });

  test("the saved zoom comes back as its nearest step; a missing or unreadable one opens at 100%", () => {
    expect(savedZoomFactor({ factor: 0.9 })).toBe(0.9);
    expect(savedZoomFactor({ factor: 0.66 })).toBe(0.67);
    expect(savedZoomFactor({ factor: 40 })).toBe(2);
    for (const saved of [undefined, null, {}, { factor: "0.9" }, { factor: Number.NaN }, 0.9]) {
      expect(savedZoomFactor(saved)).toBe(1);
    }
  });
});
