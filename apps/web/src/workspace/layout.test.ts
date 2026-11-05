import { describe, expect, test } from "bun:test";
import { dragTo, loadLayout } from "./layout.ts";

const stored = (value: string | null): Pick<Storage, "getItem"> => ({ getItem: () => value });
const wide = { sidebarWidth: 268, rail: false };

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
