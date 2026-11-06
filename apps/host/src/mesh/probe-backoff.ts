import type { Clock } from "./clock.ts";
import { DIAL_LIMITS } from "./dial-policy.ts";

/**
 * Members whose add failed with herdr's retryable kinds, on section 8.2's probe backoff: retried 30 s later, doubling
 * to 5 minutes. `fire` runs when one is due; a member that is added, leaves the view or the host stops is cleared.
 */
export class ProbeBackoff {
  readonly #clock: Clock;
  readonly #fire: () => void;
  readonly #retries = new Map<string, { readonly attempts: number; readonly cancel: () => void }>();

  constructor(clock: Clock, fire: () => void) {
    this.#clock = clock;
    this.#fire = fire;
  }

  later(hostId: string): void {
    const attempts = (this.#retries.get(hostId)?.attempts ?? 0) + 1;
    this.#retries.get(hostId)?.cancel();
    const wait = Math.min(DIAL_LIMITS.probeFirstMs * 2 ** (attempts - 1), DIAL_LIMITS.probeMaxMs);
    this.#retries.set(hostId, { attempts, cancel: this.#clock.after(wait, this.#fire) });
  }

  clear(hostId: string): void {
    this.#retries.get(hostId)?.cancel();
    this.#retries.delete(hostId);
  }

  /** Clears every member that `keep` rejects (all of them when it is omitted). */
  clearExcept(keep: (hostId: string) => boolean = () => false): void {
    for (const hostId of this.#retries.keys()) if (!keep(hostId)) this.clear(hostId);
  }
}
