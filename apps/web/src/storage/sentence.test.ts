import { expect, test } from "bun:test";
import { asSentence } from "./sentence.ts";

test.each([
  ["IndexedDB is not available here", "IndexedDB is not available here."],
  ["Quota exceeded.", "Quota exceeded."],
  ["  spaced  ", "spaced."],
  ["", ""],
] as const)("%p -> %p", (input, expected) => {
  expect(asSentence(input)).toBe(expected);
});
