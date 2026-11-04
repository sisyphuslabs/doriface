/** A peer whose claim ended without its `done` has its claims ignored this long: the safety net's interval. */
export const CLAIM_COOLDOWN_MS = 600_000;

export interface Floor {
  readonly n: number;
  readonly peer: string;
}

interface Held {
  readonly n: number;
  /** The session whose hello made the claim: it lasts as long as that session makes progress (section 10.1). */
  readonly owner: object;
}

/**
 * The counters of this host's own key that peers' hellos claim (section 10.1). A claim holds this host's own records
 * back until the claimer's `done` on the session that made it, with no wall-clock cap, so an honest slow answer never
 * lets a restored host fork its own chain; that session's answer deadline is progress-based (30 s without a records
 * or `done` line closes it 4400). Any other end of that session (the 4400, a close, a redial that replaces it, a
 * malformed line, a transport error) makes the peer's claims ignored for 10 minutes, so no renewal tactic holds it.
 */
export class Claims {
  readonly #now: () => number;
  readonly #ignored: (peer: string, n: number) => void;
  readonly #held = new Map<string, Held>();
  readonly #ignoredUntil = new Map<string, number>();

  constructor(now: () => number, ignored: (peer: string, n: number) => void) {
    this.#now = now;
    this.#ignored = ignored;
  }

  /** A peer's hello on `owner` claims counter `n` of this host's key, above its own; false while it is ignored. */
  claim(peer: string, n: number, owner: object): boolean {
    if (this.#now() < (this.#ignoredUntil.get(peer) ?? Number.NEGATIVE_INFINITY)) return false;
    const held = this.#held.get(peer);
    this.#held.set(peer, { n: Math.max(n, held?.n ?? 0), owner: held?.owner ?? owner });
    return true;
  }

  /** The claimer's `done` arrived: what it held of this host's key came with it. */
  answered(peer: string): void {
    this.#held.delete(peer);
  }

  /** `owner` ended without the `done`: if it carried the peer's claim, the claim goes and the cooldown starts. */
  ended(peer: string, owner: object): void {
    const held = this.#held.get(peer);
    if (held === undefined || held.owner !== owner) return;
    this.#held.delete(peer);
    this.#ignoredUntil.set(peer, this.#now() + CLAIM_COOLDOWN_MS);
    this.#ignored(peer, held.n);
  }

  /** The highest claim standing, and whose it is. */
  floor(): Floor | undefined {
    let top: Floor | undefined;
    for (const [peer, held] of this.#held) if (top === undefined || held.n > top.n) top = { n: held.n, peer };
    return top;
  }
}
