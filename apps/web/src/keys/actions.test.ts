import { expect, test } from "bun:test";
import { displayActionId } from "./actions.ts";

test.each([
  ["send:\u0017", "send:\\x17"],
  ["send:\u001bb", "send:\\x1bb"],
  ["send:ls", "send:ls"],
  ["tab.new", "tab.new"],
] as const)("%p shows as %p", (id, shown) => {
  expect(displayActionId(id)).toBe(shown);
});
