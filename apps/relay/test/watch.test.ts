import { describe, expect, test } from "bun:test";
import { Matches } from "./support/watch.ts";

describe("Matches", () => {
  test("a wait that times out is no longer registered, and a later match resolves only new waits", async () => {
    const items = new Matches<string>();
    const expired = await items
      .next((item) => item === "late", "a late item", 10)
      .then(
        () => "resolved",
        (error: unknown) => String(error),
      );
    expect(expired).toContain("a late item did not happen within 10 ms");
    expect(items.waiting).toBe(0);
    items.push("late");
    expect(await items.next((item) => item === "late", "the late item")).toBe("late");
  });
});
