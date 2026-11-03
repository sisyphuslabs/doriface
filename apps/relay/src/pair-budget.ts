/** Pairing budgets (contract v1.2), kept free of Workers APIs so they are testable on their own. */

/** The cap a slot applies per window to lookups, and separately to answered pairing sessions, from all sources. */
export const PAIR_BUDGET = 10;
/** The cap one source has per slot per window on lookups, and separately on pairing sessions. */
export const PER_SOURCE_PAIR_QUOTA = 3;
export const PAIR_BUDGET_WINDOW_MS = 10 * 60 * 1000;

export function liveAttempts(times: readonly number[], now: number): number[] {
  return times.filter((time) => time > now - PAIR_BUDGET_WINDOW_MS);
}

export function withinBudget(times: readonly number[], now: number, limit: number): boolean {
  return liveAttempts(times, now).length < limit;
}

/** Spends one attempt; `times` are the attempts still counted afterwards. */
export function spendAttempt(
  times: readonly number[],
  now: number,
  limit: number = PAIR_BUDGET,
): { readonly allowed: boolean; times: number[] } {
  const live = liveAttempts(times, now);
  if (live.length >= limit) return { allowed: false, times: live };
  return { allowed: true, times: [...live, now] };
}

/** When the newest attempt in `times` stops counting, or 0 for none. */
export function budgetResetAt(times: readonly number[]): number {
  return times.length === 0 ? 0 : Math.max(...times) + PAIR_BUDGET_WINDOW_MS;
}
