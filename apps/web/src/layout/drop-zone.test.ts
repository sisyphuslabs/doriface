import { describe, expect, test } from "bun:test";
import { dropPreview, dropZone } from "./drop-zone.ts";

const pane = { x: 100, y: 200, width: 800, height: 400 };

describe("drop zones (herdr-app's drop_zone)", () => {
  test.each([
    [500, 400, "swap"],
    [110, 400, "left"],
    [890, 400, "right"],
    [500, 210, "top"],
    [500, 590, "bottom"],
    [99, 400, null],
    [500, 600, null],
  ] as const)("at (%d, %d) a drop is %p", (x, y, zone) => {
    expect(dropZone(pane, x, y)).toBe(zone);
  });

  test("the edge band is a quarter of the pane's own width or height, so it scales with the pane", () => {
    expect(dropZone(pane, 100 + 800 * 0.24, 400)).toBe("left");
    expect(dropZone(pane, 100 + 800 * 0.26, 400)).toBe("swap");
    expect(dropZone(pane, 500, 200 + 400 * 0.76)).toBe("bottom");
  });

  test("an empty pane takes no drop", () => {
    expect(dropZone({ x: 0, y: 0, width: 0, height: 100 }, 0, 50)).toBeNull();
  });
});

describe("drop preview", () => {
  test("an edge shows the half the moved pane will take, a swap the whole pane", () => {
    expect(dropPreview(pane, "left")).toEqual({ x: 100, y: 200, width: 400, height: 400 });
    expect(dropPreview(pane, "right")).toEqual({ x: 500, y: 200, width: 400, height: 400 });
    expect(dropPreview(pane, "top")).toEqual({ x: 100, y: 200, width: 800, height: 200 });
    expect(dropPreview(pane, "bottom")).toEqual({ x: 100, y: 400, width: 800, height: 200 });
    expect(dropPreview(pane, "swap")).toEqual(pane);
  });
});
