import { expect, test } from "bun:test";
import { splitLanding } from "./split-landing.ts";

test("a split's terminal lands in the split, in a new tab when the pane had closed, and here when the write failed", () => {
  expect(splitLanding(true, false)).toBe("split");
  expect(splitLanding(false, true)).toBe("own-tab");
  // A failed write is not a closed pane: no new document tab, no "the pane had closed" notice.
  expect(splitLanding(false, false)).toBe("here");
});
