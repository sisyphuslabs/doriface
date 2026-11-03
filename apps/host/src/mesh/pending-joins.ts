/** A join that passed the card checks and waits for the inviting member's confirmation (section 4.3). */
export interface PendingJoin {
  readonly nonce: string;
  readonly name: string;
  readonly hostId: string;
  readonly fingerprint: string;
  /** Milliseconds since the epoch: the offer's expiry, which the pending join shares. */
  readonly expiresAt: number;
}

export type JoinDecision = "approved" | "denied" | "expired";

interface Waiting {
  readonly join: PendingJoin;
  readonly decided: PromiseWithResolvers<JoinDecision>;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * The pending joins of this host, in memory only: they die with the offer or the host (section 10.1). The inviting
 * member approves or denies each one, on its terminal or through `mesh-approve`; `mesh pair --auto` approves without
 * asking until its offer expires.
 */
export class PendingJoins {
  readonly #waiting = new Map<string, Waiting>();
  readonly #watchers: ((join: PendingJoin) => void)[] = [];
  #autoUntil = 0;

  /** Approves every join until `until` (the `--auto` offer's expiry); 0 turns it off. */
  setAuto(until: number): void {
    this.#autoUntil = until;
  }

  ask(join: PendingJoin, now = Date.now()): Promise<JoinDecision> {
    if (now >= join.expiresAt) return Promise.resolve("expired");
    if (now < this.#autoUntil) return Promise.resolve("approved");
    const decided = Promise.withResolvers<JoinDecision>();
    const timer = setTimeout(() => this.#settle(join.nonce, "expired"), join.expiresAt - now);
    this.#waiting.set(join.nonce, { join, decided, timer });
    for (const watcher of this.#watchers.splice(0)) watcher(join);
    return decided.promise;
  }

  /** Approves or denies the pending join with this nonce; false when there is none (decided, expired, unknown). */
  decide(nonce: string, approve: boolean): boolean {
    return this.#settle(nonce, approve ? "approved" : "denied");
  }

  list(): readonly PendingJoin[] {
    return [...this.#waiting.values()].map((waiting) => waiting.join);
  }

  /** The oldest pending join, or the next one asked; this is what a foreground `mesh pair` waits on. */
  next(): Promise<PendingJoin> {
    const [first] = this.list();
    if (first !== undefined) return Promise.resolve(first);
    return new Promise((resolve) => this.#watchers.push(resolve));
  }

  #settle(nonce: string, decision: JoinDecision): boolean {
    const waiting = this.#waiting.get(nonce);
    if (waiting === undefined) return false;
    this.#waiting.delete(nonce);
    clearTimeout(waiting.timer);
    waiting.decided.resolve(decision);
    return true;
  }
}
