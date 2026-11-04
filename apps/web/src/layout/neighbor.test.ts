import { describe, expect, test } from "bun:test";
import type { Node } from "@doriface/protocol/layout";
import { nearest } from "./neighbor.ts";
import { arrange } from "./rects.ts";

const block = (id: string): Node => ({ content: { terminal: id }, id, type: "block" });
const box = (type: "row" | "column", id: string, children: Node[]): Node => ({ children, id, type });

// ⌘D ⌘⇧D ⌘D ⌘⇧D from one pane: one | (two / (three | (four / five))).
const TREE = box("row", "root", [
  block("one"),
  box("column", "c1", [
    block("two"),
    box("row", "r1", [block("three"), box("column", "c2", [block("four"), block("five")])]),
  ]),
]);
const { panes } = arrange(TREE, { x: 0, y: 0, width: 1000, height: 800 }, 8);

describe("moving focus by direction", () => {
  test.each([
    ["five", "up", "four"],
    ["four", "left", "three"],
    ["three", "up", "two"],
    ["two", "left", "one"],
    ["five", "left", "three"],
    ["three", "right", "four"],
  ] as const)("from %s, %s lands on %s", (from, direction, lands) => {
    expect(nearest(from, direction, panes)).toBe(lands);
  });

  test("nothing lies past the edge of the tab", () => {
    expect(nearest("one", "left", panes)).toBeNull();
    expect(nearest("two", "up", panes)).toBeNull();
  });

  test("among panes equally close, the one focused last wins, as in herdr-app", () => {
    expect(nearest("one", "right", panes)).toBe("two");
    expect(nearest("one", "right", panes, ["three", "two"])).toBe("two");
    expect(nearest("one", "right", panes, ["two", "three"])).toBe("three");
  });
});
