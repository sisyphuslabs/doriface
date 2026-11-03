import { expect, test } from "bun:test";
import { mayTakeFocus } from "./focus-guard.ts";

test.each([
  [{ overlayOpen: true, focusIsFree: true }, false],
  [{ overlayOpen: true, focusIsFree: false }, false],
  [{ overlayOpen: false, focusIsFree: false }, false],
  [{ overlayOpen: false, focusIsFree: true }, true],
] as const)("%p -> %p", (state, expected) => {
  expect(mayTakeFocus(state)).toBe(expected);
});
