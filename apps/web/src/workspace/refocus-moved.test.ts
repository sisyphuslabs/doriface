import { describe, expect, test } from "bun:test";
import { refocusMoved } from "./refocus-moved.ts";

const button = () => {
  const calls: string[] = [];
  return { calls, focus: () => void calls.push("focus") };
};
const body = { id: "body" } as unknown as Element;
const elsewhere = { id: "elsewhere" } as unknown as Element;

describe("focus a reorder dropped goes back to the moved row (#161)", () => {
  test("the move took focus off the row (focus on the body, or nowhere): the row's button is focused again", () => {
    for (const active of [body, null]) {
      const moved = button();
      expect(refocusMoved(moved, active, body)).toBe(true);
      expect(moved.calls).toEqual(["focus"]);
    }
  });

  test("focus the person moved elsewhere since is left there", () => {
    const moved = button();
    expect(refocusMoved(moved, elsewhere, body)).toBe(false);
    expect(moved.calls).toEqual([]);
  });

  test("a row whose button is gone is not focused", () => {
    expect(refocusMoved(undefined, body, body)).toBe(false);
  });
});
