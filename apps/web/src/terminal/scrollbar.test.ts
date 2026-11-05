import { describe, expect, test } from "bun:test";
import {
  atBottom,
  awayFromBottom,
  type ScrollBox,
  scrollbarGrabAt,
  scrollbarLane,
  scrollbarRowAt,
  scrollbarThumb,
  scrollRows,
  scrollTopAtRow,
  scrollTopFor,
} from "./scrollbar.ts";

describe("scrollbarThumb", () => {
  test("the thumb is the viewport's share of the track, placed at its share of the travel", () => {
    expect(scrollbarThumb({ total: 100, offset: 0, len: 25 }, 400, 16)).toEqual({ top: 0, length: 100 });
    expect(scrollbarThumb({ total: 100, offset: 75, len: 25 }, 400, 16)).toEqual({ top: 300, length: 100 });
    expect(scrollbarThumb({ total: 100, offset: 37.5, len: 25 }, 400, 16)).toEqual({ top: 150, length: 100 });
  });

  test("a huge scrollback keeps the thumb one cell tall, and it still reaches both ends", () => {
    const thumb = scrollbarThumb({ total: 3025, offset: 3000, len: 25 }, 400, 16);
    expect(thumb).toEqual({ top: 384, length: 16 });
    expect(scrollbarThumb({ total: 3025, offset: 0, len: 25 }, 400, 16)?.top).toBe(0);
  });

  test("nothing to scroll, no rows or no track draws no thumb", () => {
    expect(scrollbarThumb({ total: 25, offset: 0, len: 25 }, 400, 16)).toBeNull();
    expect(scrollbarThumb({ total: 10, offset: 0, len: 25 }, 400, 16)).toBeNull();
    expect(scrollbarThumb({ total: 100, offset: 0, len: 0 }, 400, 16)).toBeNull();
    expect(scrollbarThumb({ total: 100, offset: 0, len: 25 }, 0, 16)).toBeNull();
  });
});

describe("scrollbarLane", () => {
  test("runs from the text's end to the edge, the last 8 px when the text runs closer, never past the pane", () => {
    expect(scrollbarLane(1000, 985.5, 8)).toBe(14.5);
    expect(scrollbarLane(1000, 994, 8)).toBe(8);
    expect(scrollbarLane(6, 4, 8)).toBe(6);
  });
});

describe("dragging the thumb", () => {
  test("a press on the thumb keeps its grab point; a press beside it grabs the middle", () => {
    expect(scrollbarGrabAt(100, 50, 120)).toBe(20);
    expect(scrollbarGrabAt(100, 50, 300)).toBe(25);
    expect(scrollbarGrabAt(100, 50, 99)).toBe(25);
  });

  test("a thumb top maps back to the row it shows, clamped to the travel", () => {
    expect(scrollbarRowAt(100, 25, 400, 16, 0)).toBe(0);
    expect(scrollbarRowAt(100, 25, 400, 16, 150)).toBe(38);
    expect(scrollbarRowAt(100, 25, 400, 16, 300)).toBe(75);
    expect(scrollbarRowAt(100, 25, 400, 16, 900)).toBe(75);
    expect(scrollbarRowAt(100, 25, 400, 16, -40)).toBe(0);
    expect(scrollbarRowAt(25, 25, 400, 16, 100)).toBe(0);
  });

  test("the row a thumb lands on draws the thumb back where it was dragged, to the row", () => {
    for (const top of [0, 37, 150, 299.5, 384]) {
      const row = scrollbarRowAt(3025, 25, 400, 16, top);
      const drawn = scrollbarThumb({ total: 3025, offset: row, len: 25 }, 400, 16);
      expect(Math.abs((drawn?.top ?? -1) - Math.min(top, 384))).toBeLessThanOrEqual(384 / 3000);
    }
  });
});

// 3000 lines of scrollback over a 25-row grid of 16 px rows, with wterm's 12 px padding and 7 px left over below.
const box = (scrollTop: number): ScrollBox => ({
  scrollTop,
  scrollHeight: 3025 * 16 + 24,
  clientHeight: 25 * 16 + 24 + 7,
  rowHeight: 16,
  rows: 25,
  scrollback: 3000,
});
const BOTTOM = 3000 * 16 - 7;

describe("the view's rows", () => {
  test("at the bottom it shows the last row, though the padding leaves less than a row to scroll", () => {
    expect(atBottom(box(BOTTOM))).toBe(true);
    expect(scrollRows(box(BOTTOM))).toEqual({ total: 3025, offset: 3000, len: 25 });
    expect(scrollRows(box(160))).toEqual({ total: 3025, offset: 10, len: 25 });
  });

  test("more than a row above the bottom is away from it; less is not", () => {
    expect(awayFromBottom(box(BOTTOM - 16))).toBe(false);
    expect(awayFromBottom(box(BOTTOM - 17))).toBe(true);
    expect(awayFromBottom(box(0))).toBe(true);
  });
});

describe("scroll targets", () => {
  test("lines and pages move by whole rows from where the view is, ends go to the ends", () => {
    expect(scrollTopFor(box(160), { lines: -3 })).toBe(7 * 16);
    expect(scrollTopFor(box(160), { lines: 2 })).toBe(12 * 16);
    expect(scrollTopFor(box(160), { pages: -1 })).toBe(0);
    expect(scrollTopFor(box(160), { pages: 1 })).toBe(35 * 16);
    expect(scrollTopFor(box(160), { to: "top" })).toBe(0);
    expect(scrollTopFor(box(160), { to: "bottom" })).toBe(BOTTOM);
  });

  test("a move that reaches the last row lands at the bottom, where output is followed again", () => {
    expect(scrollTopFor(box(BOTTOM - 32), { lines: 5 })).toBe(BOTTOM);
    expect(scrollTopAtRow(box(0), 3000)).toBe(BOTTOM);
    expect(scrollTopAtRow(box(0), 12)).toBe(192);
  });
});
