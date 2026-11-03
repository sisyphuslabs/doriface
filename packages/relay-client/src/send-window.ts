import { SESSION_WINDOW_BYTES } from "./wire/index.ts";

interface Waiting {
  readonly bytes: number;
  readonly go: () => void;
  readonly fail: (error: Error) => void;
}

/**
 * A sender's session credit: at most `limit` bytes in flight once the far side has granted credit at all. Until then
 * every send goes at once, so a relay or peer without credit support behaves as before. Sends keep their order.
 */
export class SendWindow {
  readonly #limit: number;
  readonly #waiting: Waiting[] = [];
  readonly #idle = new Set<() => void>();
  #inFlight = 0;
  #enforced = false;

  constructor(limit = SESSION_WINDOW_BYTES) {
    this.#limit = limit;
  }

  admit(bytes: number, go: () => void, fail: (error: Error) => void): void {
    if (this.#waiting.length > 0 || !this.#fits(bytes)) {
      this.#waiting.push({ bytes, go, fail });
      return;
    }
    this.#inFlight += bytes;
    go();
  }

  /** The far side consumed `bytes` more; false when that is more than is in flight. */
  credit(bytes: number): boolean {
    this.#enforced = true;
    if (bytes > this.#inFlight) return false;
    this.#inFlight -= bytes;
    for (let next = this.#waiting[0]; next !== undefined && this.#fits(next.bytes); next = this.#waiting[0]) {
      this.#waiting.shift();
      this.#inFlight += next.bytes;
      next.go();
    }
    if (this.#waiting.length === 0) for (const wake of this.#idle) wake();
    return true;
  }

  drained(): Promise<void> {
    if (this.#waiting.length === 0) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    const wake = (): void => {
      this.#idle.delete(wake);
      resolve();
    };
    this.#idle.add(wake);
    return promise;
  }

  drop(error: Error): void {
    const dropped = this.#waiting.splice(0);
    for (const wake of this.#idle) wake();
    for (const waiting of dropped) waiting.fail(error);
  }

  #fits(bytes: number): boolean {
    return !this.#enforced || this.#inFlight === 0 || this.#inFlight + bytes <= this.#limit;
  }
}
