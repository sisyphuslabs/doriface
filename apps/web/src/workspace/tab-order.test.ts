import { expect, test } from "bun:test";
import { moveTabTo } from "./tab-order.ts";

test("moving a tab changes only the order, and an index past either end changes nothing", () => {
  const three = ["a", "b", "c"];
  expect(moveTabTo(three, null, "a", 2).order).toEqual(["b", "c", "a"]);
  expect(moveTabTo(three, null, "c", 0).order).toEqual(["c", "a", "b"]);
  for (const [key, to] of [
    ["a", 0],
    ["a", -1],
    ["a", 3],
    ["zz", 1],
    ["a", 1.5],
  ] as const) {
    expect(moveTabTo(three, null, key, to).order).toBe(three);
  }
});

test("a move that changes nothing is not said: the tab left the strip in the same frame", () => {
  const said = { key: "b", count: 3 };
  // A document event took "gone" away while the strip still showed it; the move finds nothing to move.
  const stale = moveTabTo(["a", "b"], said, "gone", 0);
  expect(stale.order).toEqual(["a", "b"]);
  expect(stale.said).toBe(said);
  expect(moveTabTo(["a", "b"], said, "a", 0).said).toBe(said);

  expect(moveTabTo(["a", "b"], said, "a", 1)).toEqual({ order: ["b", "a"], said: { key: "a", count: 4 } });
});
