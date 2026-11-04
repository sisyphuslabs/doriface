import { describe, expect, test } from "bun:test";
import { floorFor } from "./row-floors.ts";

/** A font where the ellipsis is wider than a letter, as it is in most UI fonts. */
const width = (text: string): number =>
  [...text].reduce((sum, character) => sum + (character === "\u2026" ? 12 : 7), 0);

describe("floorFor", () => {
  test("a text longer than the floor keeps its first characters and an ellipsis", () => {
    expect(floorFor("benchmark-row", 5, width)).toBe(5 * 7 + 12);
  });

  test("a text one character past the floor is never floored wider than itself, so no gap follows it", () => {
    expect(floorFor("home-a", 5, width)).toBe(6 * 7);
  });

  test("a text within the floor keeps its own width", () => {
    expect(floorFor("sh", 5, width)).toBe(2 * 7);
  });
});
