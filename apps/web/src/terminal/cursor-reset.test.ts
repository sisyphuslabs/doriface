import { describe, expect, test } from "bun:test";
import { resetsCursor } from "./cursor-reset.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("resetsCursor", () => {
  test.each([
    ["\u001b[ q", true],
    ["\u001b[0 q", true],
    ["prompt$ \u001b[0 q", true],
    ["\u001b[5 q", false],
    ["\u001b[2 q", false],
    ["plain text q", false],
  ])("%j -> %p", (text, expected) => expect(resetsCursor(bytes(text))).toBe(expected));
});
