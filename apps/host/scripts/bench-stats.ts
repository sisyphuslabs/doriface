/**
 * The statistics the latency bench reports, kept pure so a test can catch a wrong measurement: warm-up calls are timed
 * apart and never summarized, percentiles are nearest-rank, and a summary needs enough samples for its p99 to be one.
 */

/** Below 100 samples a nearest-rank p99 is the largest sample, so the bench refuses to report one. */
export const MIN_SAMPLES = 100;

export interface Summary {
  readonly calls: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
}

/** Nearest-rank percentile of ascending samples: the sample at rank ceil(p/100 * n), 1-based. */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p * sorted.length) / 100));
  const value = sorted[rank - 1];
  if (value === undefined) throw new Error("no samples to take a percentile of");
  return value;
}

/** p50, p95 and p99 (nearest-rank) and the extremes; refuses fewer than MIN_SAMPLES samples. */
export function summarize(samples: readonly number[]): Summary {
  if (samples.length < MIN_SAMPLES) {
    throw new Error(`a p99 needs at least ${MIN_SAMPLES} samples, got ${samples.length}`);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    calls: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: percentile(sorted, 0),
    max: percentile(sorted, 100),
  };
}

export interface Counts {
  readonly calls: number;
  readonly warmup: number;
}

export interface Timing {
  /** The warm-up calls' durations, in order: reported apart, never summarized. */
  readonly warmup: readonly number[];
  /** The measured calls' durations, in order. */
  readonly samples: readonly number[];
}

/** Times `warmup + calls` sequential calls of `call` by `now` (ms) and returns the warm-up durations apart. */
export async function measure(
  call: () => Promise<unknown>,
  counts: Counts,
  now: () => number = () => performance.now(),
): Promise<Timing> {
  const timeEach = async (left: number, durations: number[]): Promise<number[]> => {
    if (left === 0) return durations;
    const started = now();
    await call();
    durations.push(now() - started);
    return timeEach(left - 1, durations);
  };
  const durations = await timeEach(counts.warmup + counts.calls, []);
  return { warmup: durations.slice(0, counts.warmup), samples: durations.slice(counts.warmup) };
}
