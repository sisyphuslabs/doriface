/** Per-slot pairing budget (contract v1.2 C7), kept free of Workers APIs so it is testable on its own. */

export const PAIR_BUDGET = 10;
export const PAIR_BUDGET_WINDOW_MS = 10 * 60 * 1000;

/** Spends one of the slot's attempts in the sliding 10-minute window; `times` are the attempts still counted. */
export function spendAttempt(times: readonly number[], now: number): { readonly allowed: boolean; times: number[] } {
  const live = times.filter((time) => time > now - PAIR_BUDGET_WINDOW_MS);
  if (live.length >= PAIR_BUDGET) return { allowed: false, times: live };
  return { allowed: true, times: [...live, now] };
}

/** When the newest attempt in `times` stops counting, or 0 for none. */
export function budgetResetAt(times: readonly number[]): number {
  return times.length === 0 ? 0 : Math.max(...times) + PAIR_BUDGET_WINDOW_MS;
}
