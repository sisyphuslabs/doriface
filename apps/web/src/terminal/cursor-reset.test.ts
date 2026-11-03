import { describe, expect, test } from "bun:test";
import { CursorResets } from "./cursor-reset.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const once = (text: string) => new CursorResets().push(bytes(text));

describe("CursorResets", () => {
  test.each([
    ["\u001b[ q", true],
    ["\u001b[0 q", true],
    ["prompt$ \u001b[0 q", true],
    ["\u0018\u001b[!p\u001b[?2026l", true],
    ["\u001bc", true],
    ["\u001b[5 q", false],
    ["\u001b[q", false],
    ["plain text q", false],
  ])("%j -> %p", (text, expected) => expect(once(text)).toBe(expected));

  test("a program's shape after a reset in the same chunk wins", () => {
    expect(once("\u001b[!p\u001b[5 q")).toBe(false);
    expect(once("\u001b[5 q\u001b[!p")).toBe(true);
  });

  test("a reset split across chunks is seen when it completes", () => {
    const scanner = new CursorResets();
    expect(scanner.push(bytes("text \u001b["))).toBe(false);
    expect(scanner.push(bytes("0 q more"))).toBe(true);
    expect(scanner.push(bytes("plain"))).toBe(false);
  });
});
