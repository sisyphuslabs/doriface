import { expect, test } from "bun:test";
import { formatCode, normalizeCode, slotOf } from "./code.ts";

test.each([
  ["7kq3 9d2m", "7KQ39D2M"],
  ["7KQ3-9D2M", "7KQ39D2M"],
  ["OIL3 9D2M", "01139D2M"],
  ["7KQ3 9D2", null],
  ["7KQ3 9D2U", null],
])("normalizes %p to %p", (input, expected) => {
  expect(normalizeCode(input)).toBe(expected);
});

test("the slot is the first three characters and display groups by four", () => {
  expect(slotOf("7KQ39D2M")).toBe("7KQ");
  expect(formatCode("7KQ39D2M")).toBe("7KQ3 9D2M");
});
