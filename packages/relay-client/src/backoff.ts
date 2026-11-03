export const BACKOFF_MIN_MS = 250;
export const BACKOFF_MAX_MS = 30_000;

/** Jittered exponential delay before reconnect attempt `attempt` (0-based): uniform in [250 ms, min(30 s, 250 ms * 2^(attempt+1))]. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (attempt + 1));
  return Math.round(BACKOFF_MIN_MS + random() * (ceiling - BACKOFF_MIN_MS));
}
