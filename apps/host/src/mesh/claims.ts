import type { Clock } from "./clock.ts";

/** Section 10.1: how long a peer's claim on this host's counter holds its own records back without a `done`. */
export const CLAIM_MS = 30_000;
/** A peer whose claim went unanswered has its claims ignored this long: the safety net's interval. */
export const CLAIM_COOLDOWN_MS = 600_000;

export interface Floor {
  readonly n: number;
  readonly peer: string;
}

interface Held {
  readonly n: number;
  readonly cancel: () => void;
}

/**
 * The counters of this host's own key that peers' hellos claim (section 10.1). A claim holds this host's own records
 * back until the claimer's next `done`, for at most 30 s; one left unanswered, by the clock or by a session closed
 * for owing its `done`, makes that peer's claims ignored for 10 minutes, so redialing cannot renew it.
 */
export class Claims {
  readonly #clock: Clock;
  readonly #unanswered: (peer: string, n: number) => void;
  readonly #held = new Map<string, Held>();
  readonly #ignoredUntil = new Map<string, number>();

  constructor(clock: Clock, unanswered: (peer: string, n: number) => void) {
    this.#clock = clock;
    this.#unanswered = unanswered;
  }

  /** A peer's hello claims counter `n` of this host's key, above its own. */
  claim(peer: string, n: number): void {
    if (this.#clock.now() < (this.#ignoredUntil.get(peer) ?? Number.NEGATIVE_INFINITY)) return;
    const held = this.#held.get(peer);
    const cancel = held?.cancel ?? this.#clock.after(CLAIM_MS, () => this.unanswered(peer));
    this.#held.set(peer, { n: Math.max(n, held?.n ?? 0), cancel });
  }

  /** The peer's `done` arrived, or its session ended without a fault: its claim goes. */
  drop(peer: string): void {
    this.#held.get(peer)?.cancel();
    this.#held.delete(peer);
  }

  /** The claim went unanswered: it goes, and the peer's claims are ignored for the cooldown. */
  unanswered(peer: string): void {
    const held = this.#held.get(peer);
    if (held === undefined) return;
    this.drop(peer);
    this.#ignoredUntil.set(peer, this.#clock.now() + CLAIM_COOLDOWN_MS);
    this.#unanswered(peer, held.n);
  }

  /** The highest claim standing, and whose it is. */
  floor(): Floor | undefined {
    let top: Floor | undefined;
    for (const [peer, held] of this.#held) if (top === undefined || held.n > top.n) top = { n: held.n, peer };
    return top;
  }
}
