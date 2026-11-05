import { describe, expect, test } from "bun:test";
import { measure, MIN_SAMPLES, percentile, summarize } from "./bench-stats.ts";

const ascending = (n: number): number[] => Array.from({ length: n }, (_, index) => index + 1);

describe("summarize", () => {
  test("nearest-rank: p50 of 1..100 is the 50th smallest, not the 51st", () => {
    expect(summarize(ascending(100)).p50).toBe(50);
  });

  test("nearest-rank: p99 of 200 is the 198th smallest, the third-largest", () => {
    const samples = ascending(200).toReversed();
    expect(summarize(samples)).toMatchObject({ calls: 200, p50: 100, p95: 190, p99: 198, min: 1, max: 200 });
  });

  test("a p99 from fewer than 100 samples is refused, since it would be the maximum", () => {
    expect(MIN_SAMPLES).toBe(100);
    expect(() => summarize(ascending(99))).toThrow("at least 100 samples");
    expect(summarize(ascending(100)).p99).toBe(99);
  });

  test("the samples are sorted by value, not as strings", () => {
    const samples = [...ascending(98), 1000, 20_000].toReversed();
    expect(summarize(samples)).toMatchObject({ p99: 1000, max: 20_000, min: 1 });
  });
});

describe("percentile", () => {
  test("ranks round up, and p0 is the smallest", () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });

  test("no samples is an error, not a zero", () => {
    expect(() => percentile([], 50)).toThrow("no samples");
  });
});

describe("measure", () => {
  test("warm-up calls are timed apart and never reach the stats", async () => {
    let clock = 0;
    let made = 0;
    // Each warm-up call takes 1000 ms; measured call k (1-based) takes k ms.
    const call = async (): Promise<void> => {
      made += 1;
      clock += made <= 10 ? 1000 : made - 10;
    };
    const timing = await measure(call, { calls: 100, warmup: 10 }, () => clock);
    expect(made).toBe(110);
    expect(timing.warmup).toEqual(Array.from({ length: 10 }, () => 1000));
    expect(timing.samples).toEqual(ascending(100));
    expect(summarize(timing.samples)).toEqual({ calls: 100, p50: 50, p95: 95, p99: 99, min: 1, max: 100 });
  });

  test("calls run one at a time, each timed from its own start", async () => {
    let clock = 0;
    let inFlight = 0;
    let most = 0;
    const call = async (): Promise<void> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      clock += 2;
      inFlight -= 1;
    };
    const timing = await measure(call, { calls: 5, warmup: 0 }, () => clock);
    expect(most).toBe(1);
    expect(timing).toEqual({ warmup: [], samples: [2, 2, 2, 2, 2] });
  });
});
