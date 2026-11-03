import { describe, expect, test } from "bun:test";
import { neighbour } from "./use-app-actions.ts";

describe("neighbour", () => {
  test("steps through the list and wraps", () => {
    expect(neighbour(["t1", "t2", "t3"], "t3", 1)).toBe("t1");
    expect(neighbour(["t1", "t2", "t3"], "t1", -1)).toBe("t3");
  });

  test("is null when the only target is the current one, so the key is not swallowed", () => {
    expect(neighbour(["t1"], "t1", 1)).toBeNull();
    expect(neighbour([], null, 1)).toBeNull();
  });
});
