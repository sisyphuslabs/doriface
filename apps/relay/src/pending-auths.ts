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

  begin(ws: WebSocket, timeoutMs: number, onTimeout: () => void): void {
    const timer = setTimeout(() => {
      onTimeout();
      this.settle(ws);
    }, timeoutMs);
    this.#pending.set(ws, { settled: Promise.withResolvers(), timer });
  }

  settle(ws: WebSocket): void {
    const pending = this.#pending.get(ws);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    pending.settled.resolve();
    this.#pending.delete(ws);
  }

  /**
   * Resolves once every uplink pending now has settled. Uplinks that arrive later are not waited for, so a stream of
   * unanswered uplinks delays a caller by at most one auth timeout.
   */
  async allPendingNow(): Promise<void> {
    await Promise.all([...this.#pending.values()].map(({ settled }) => settled.promise));
  }
}
