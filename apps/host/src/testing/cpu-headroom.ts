import { expect } from "bun:test";

/** bun's default per-test timeout. */
export const TEST_BUDGET_MS = 5_000;

/**
 * Fails the test when its body's CPU time exceeds `budgetMs / headroom` (#149), `budgetMs` being the test's timeout:
 * the headroom factor decides how small a share of a core the test still passes on, and CPU time does not grow while
 * the process waits for a core.
 */
export function cpuHeadroom<T>(
  headroom: number,
  body: () => T | Promise<T>,
  budgetMs = TEST_BUDGET_MS,
): () => Promise<void> {
  return async () => {
    const start = process.cpuUsage();
    await body();
    const used = process.cpuUsage(start);
    const usedMs = (used.user + used.system) / 1000;
    const limitMs = budgetMs / headroom;
    expect(
      usedMs,
      `the test used ${usedMs.toFixed(0)} ms of CPU; ${headroom}x headroom under a ${budgetMs} ms budget allows ${limitMs.toFixed(0)} ms`,
    ).toBeLessThanOrEqual(limitMs);
  };
}
