import { describe, expect, test } from "bun:test";
import { summarize } from "./percentiles.ts";

describe("summarize", () => {
  test("nearest-rank percentiles over sorted samples, so p99 of 200 is the 199th smallest", () => {
    const samples = Array.from({ length: 200 }, (_, index) => 200 - index);
    expect(summarize(samples)).toEqual({ calls: 200, p50: 101, p95: 191, p99: 199, min: 1, max: 200 });
  });

  test("a single sample is every percentile", () => {
    expect(summarize([7])).toEqual({ calls: 1, p50: 7, p95: 7, p99: 7, min: 7, max: 7 });
  });

  test("no samples is an error, not a row of zeros", () => {
    expect(() => summarize([])).toThrow("no samples");
  });
});
