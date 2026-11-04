import { expect, test } from "bun:test";
import { picksPane } from "./pane-focus.ts";

test("focus picks a pane only when a person moves it there: not as a terminal starts, not onto the pane in focus", () => {
  expect(picksPane(false, false)).toBe(true);
  expect(picksPane(true, false)).toBe(false);
  // The tab's first pane stands in while a split's pane is written; its focus must not replace the split's.
  expect(picksPane(false, true)).toBe(false);
});
