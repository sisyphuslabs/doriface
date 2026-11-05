import { describe, expect, test } from "bun:test";
import { clampShare, dragTo, loadLayout, shareBounds } from "./layout.ts";

const stored = (value: string | null): Pick<Storage, "getItem"> => ({ getItem: () => value });
const wide = { sidebarWidth: 268, rail: false, agentsShare: 0.4 };

describe("loadLayout", () => {
  test("reads a stored hidden sidebar, and shows it when nothing usable is stored", () => {
    expect(loadLayout(stored('{"sidebar":false}'))).toEqual({ sidebar: false, ...wide });
    expect(loadLayout(stored(null))).toEqual({ sidebar: true, ...wide });
    expect(loadLayout(stored("{not json"))).toEqual({ sidebar: true, ...wide });
    expect(loadLayout(stored('{"sidebar":"no"}'))).toEqual({ sidebar: true, ...wide });
  });

  test("reads the rail and the width, clamping a width out of range", () => {
    expect(loadLayout(stored('{"sidebar":true,"sidebarWidth":320,"rail":true}'))).toEqual({
      sidebar: true,
      sidebarWidth: 320,
      rail: true,
      agentsShare: 0.4,
    });
    expect(loadLayout(stored('{"sidebarWidth":9000}')).sidebarWidth).toBe(480);
  });
});

describe("dragTo", () => {
  test("below 160 px is the rail and keeps the width to come back to; above, the width follows, clamped", () => {
    expect(dragTo(120)).toEqual({ rail: true });
    expect(dragTo(170)).toEqual({ rail: false, sidebarWidth: 200 });
    expect(dragTo(301.6)).toEqual({ rail: false, sidebarWidth: 302 });
  });
});

describe("the Spaces/Agents split", () => {
  test("reads a stored Agents share, and keeps the default for one outside 0..1 or not a number", () => {
    expect(loadLayout(stored('{"agentsShare":0.25}')).agentsShare).toBe(0.25);
    expect(loadLayout(stored('{"agentsShare":1.5}')).agentsShare).toBe(0.4);
    expect(loadLayout(stored('{"agentsShare":0}')).agentsShare).toBe(0.4);
    expect(loadLayout(stored('{"agentsShare":"half"}')).agentsShare).toBe(0.4);
  });

  test("each section keeps 96 px beside the 1 px divider, and a list too short for both splits it in half", () => {
    expect(shareBounds(500)).toEqual({ min: 0.192, max: 0.806 });
    expect(clampShare(0.05, 500)).toBe(0.192);
    expect(clampShare(0.95, 500)).toBe(0.806);
    expect(clampShare(0.5, 480)).toBe(0.5);
    expect(clampShare(0.1, 150)).toBe(0.5);
  });
});
