import { AUTH_TIMEOUT_MS } from "./limits.ts";

interface PendingAuth {
  readonly settled: PromiseWithResolvers<void>;
  /** Cleared on settle; a pending timer keeps the object from hibernating. */
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Uplinks still answering their challenge, each bounded by the auth timeout. */
export class PendingAuths {
  readonly #pending = new Map<WebSocket, PendingAuth>();

  get size(): number {
    return this.#pending.size;
  }

  begin(ws: WebSocket, onTimeout: () => void): void {
    const timer = setTimeout(() => {
      onTimeout();
      this.settle(ws);
    }, AUTH_TIMEOUT_MS);
    this.#pending.set(ws, { settled: Promise.withResolvers(), timer });
  }

  settle(ws: WebSocket): void {
    const pending = this.#pending.get(ws);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    pending.settled.resolve();
    this.#pending.delete(ws);
  }

  /** Resolves once any pending uplink has settled. */
  next(): Promise<void> {
    return Promise.race([...this.#pending.values()].map(({ settled }) => settled.promise));
  }
}
