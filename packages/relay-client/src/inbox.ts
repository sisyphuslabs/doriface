import type { CloseListener, DataListener, Unsubscribe } from "./link.ts";

/**
 * Delivers chunks to every data listener strictly in order. Chunks that arrive before the first listener are held,
 * and a chunk is handed on only after every listener's promise for the previous one settled.
 */
export class Inbox {
  readonly #chunks: Uint8Array[] = [];
  readonly #listeners = new Set<DataListener>();
  readonly #onError: (error: unknown) => void;
  #pumping = false;

  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  add(listener: DataListener): Unsubscribe {
    this.#listeners.add(listener);
    this.#pump();
    return () => this.#listeners.delete(listener);
  }

  push(chunk: Uint8Array): void {
    this.#chunks.push(chunk);
    this.#pump();
  }

  clear(): void {
    this.#chunks.length = 0;
    this.#listeners.clear();
  }

  #pump(): void {
    if (this.#pumping || this.#listeners.size === 0 || this.#chunks.length === 0) return;
    this.#pumping = true;
    void this.#run();
  }

  async #run(): Promise<void> {
    try {
      await this.#deliver();
    } catch (error) {
      this.#pumping = false;
      this.#onError(error);
      return;
    }
    this.#pumping = false;
    this.#pump();
  }

  async #deliver(): Promise<void> {
    const chunk = this.#listeners.size === 0 ? undefined : this.#chunks.shift();
    if (chunk === undefined) return;
    await Promise.all([...this.#listeners].map((listener) => listener(chunk)));
    return this.#deliver();
  }
}

/**
 * Close listeners that run once; a listener added after the close runs on the next microtask unless it is removed
 * first. Every listener runs even if one throws; the failure is rethrown once all have run.
 */
export class CloseSignal {
  readonly #listeners = new Set<CloseListener>();
  #fired: { readonly error: Error | undefined } | undefined;

  get fired(): boolean {
    return this.#fired !== undefined;
  }

  add(listener: CloseListener): Unsubscribe {
    const fired = this.#fired;
    if (fired !== undefined) {
      let active = true;
      queueMicrotask(() => {
        if (active) listener(fired.error);
      });
      return () => {
        active = false;
      };
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  fire(error: Error | undefined): void {
    if (this.#fired !== undefined) return;
    this.#fired = { error };
    const listeners = [...this.#listeners];
    this.#listeners.clear();
    rethrowAfter(listeners.map((listener) => () => listener(error)));
  }
}

/** Runs every step even if some throw, then rethrows the failure (an AggregateError when several failed). */
export function rethrowAfter(steps: readonly (() => void)[]): void {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "close listeners failed");
}
