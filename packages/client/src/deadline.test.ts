import { describe, expect, test } from "bun:test";
import { raceDeadline } from "./deadline.ts";

const timeout = () => new Error("timed out");

describe("raceDeadline", () => {
  test("a pre-aborted signal wins and the inner rejection is still observed", async () => {
    const inner = Promise.withResolvers<number>();
    const raced = raceDeadline(inner.promise, { signal: AbortSignal.abort(new Error("gone")) }, timeout);
    inner.reject(new Error("late"));
    await expect(raced).rejects.toThrow("gone");
  });

  test("a non-finite or huge timeout does not fire early", async () => {
    expect(await raceDeadline(Promise.resolve(1), { timeoutMs: Number.POSITIVE_INFINITY }, timeout)).toBe(1);
    const later = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 20));
    expect(await raceDeadline(later, { timeoutMs: 2 ** 40 }, timeout)).toBe("done");
  });
});
