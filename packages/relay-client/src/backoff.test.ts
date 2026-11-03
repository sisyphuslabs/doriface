import { describe, expect, test } from "bun:test";
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, backoffDelay } from "./backoff.ts";

describe("reconnect backoff", () => {
  test("doubles its ceiling from 250 ms and never exceeds 30 s", () => {
    const lowest = Array.from({ length: 12 }, (_, attempt) => backoffDelay(attempt, () => 0));
    const highest = Array.from({ length: 12 }, (_, attempt) => backoffDelay(attempt, () => 1));
    expect(lowest.every((delay) => delay === BACKOFF_MIN_MS)).toBe(true);
    expect(highest).toEqual([500, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000]);
    expect(Math.max(...highest)).toBe(BACKOFF_MAX_MS);
  });
});
