import type { Clock } from "./clock.ts";

/** How late a timer may fire before its deadline counts as unobserved: the event loop was blocked meanwhile. */
export const LATE_MS = 1_000;

const idle = (): void => undefined;

/**
 * Runs `run` once `ms` have passed. A timer that fires more than LATE_MS after its due time ran behind a blocked
 * event loop, and Bun runs an expired timer before the socket data that arrived during the block, so it waits
 * LATE_MS more: a line that came meanwhile is read, and can cancel it, first. Returns the cancel.
 */
export function deadline(clock: Clock, ms: number, run: () => void): () => void {
  let cancel = idle;
  const arm = (wait: number): void => {
    const due = clock.now() + wait;
    cancel = clock.after(wait, () => (clock.now() - due > LATE_MS ? arm(LATE_MS) : run()));
  };
  arm(ms);
  return () => cancel();
}
