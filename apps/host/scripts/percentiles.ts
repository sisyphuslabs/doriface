export interface Summary {
  readonly calls: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
}

/** Nearest-rank percentiles (index floor(p/100 * n) of the sorted samples), plus the extremes. */
export function summarize(samples: readonly number[]): Summary {
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (index: number): number => {
    const value = sorted[Math.min(sorted.length - 1, index)];
    if (value === undefined) throw new Error("no samples to summarize");
    return value;
  };
  const percentile = (p: number): number => at(Math.floor((p / 100) * sorted.length));
  return {
    calls: sorted.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    min: at(0),
    max: at(sorted.length - 1),
  };
}
