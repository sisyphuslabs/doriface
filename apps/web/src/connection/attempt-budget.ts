export const ATTEMPT_DEADLINE_MS = 10_000;

/** The ceiling the deadline grows to, so a path slower than the base still lands (#635). */
export const ATTEMPT_DEADLINE_MAX_MS = 30_000;

export class AttemptTimeoutError extends Error {
  override readonly name = "AttemptTimeoutError";

  constructor(deadlineMs: number) {
    super(`The connection attempt did not finish within ${deadlineMs} ms.`);
  }
}

/** One attempt's budget: doubled after each attempt that timed out, back to the base when one opens or the page wakes. */
export class AttemptBudget {
  #deadlineMs = ATTEMPT_DEADLINE_MS;

  get deadlineMs(): number {
    return this.#deadlineMs;
  }

  /** Expiry aborts the attempt's own controller, so a dial still in flight is closed instead of left running (#653). */
  bounded<T>(work: Promise<T>, abort: AbortController): Promise<T> {
    const deadline = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        abort.abort();
        reject(new AttemptTimeoutError(this.#deadlineMs));
      }, this.#deadlineMs);
      void work.finally(() => clearTimeout(timer)).catch(() => undefined);
    });
    return Promise.race([work, deadline]);
  }

  timedOut(): void {
    this.#deadlineMs = Math.min(ATTEMPT_DEADLINE_MAX_MS, this.#deadlineMs * 2);
  }

  reset(): void {
    this.#deadlineMs = ATTEMPT_DEADLINE_MS;
  }
}
