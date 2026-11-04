import { parseRecord, type Signed } from "@doriface/mesh";
import type { Clock } from "./clock.ts";
import { deadline } from "./deadline.ts";

/** A claim this host's own records do not move for this long expires: the safety net's 30 s (section 10.1). */
export const CLAIM_MS = 30_000;
/** A peer whose claim expired has its claims ignored this long: the safety net's interval. */
export const CLAIM_COOLDOWN_MS = 600_000;

export interface Floor {
  readonly n: number;
  readonly peer: string;
}

interface Held {
  readonly n: number;
  /** This host's own counter when the claim was made or last moved. */
  readonly own: number;
  readonly cancel: () => void;
}

/**
 * The counters of this host's own key that peers' hellos claim (section 10.1). A claim belongs to the peer, not to a
 * session: ending, replacing or re-greeting a session neither resolves nor renews it, and neither does a `done`. It
 * resolves when this host holds its own records up to the claimed counter (an honest answer sends those first), and it
 * expires when 30 s pass without one of them arriving, after which the peer's claims are ignored for 10 minutes.
 */
export class Claims {
  readonly #clock: Clock;
  readonly #own: () => number;
  readonly #nameOf: (peer: string) => string;
  readonly #log: (line: string) => void;
  readonly #held = new Map<string, Held>();
  readonly #ignoredUntil = new Map<string, number>();

  constructor(clock: Clock, own: () => number, nameOf: (peer: string) => string, log: (line: string) => void) {
    this.#clock = clock;
    this.#own = own;
    this.#nameOf = nameOf;
    this.#log = log;
  }

  /** A peer's hello claims counter `n` of this host's key; true when it holds this host's own records back. */
  claim(peer: string, n: number): boolean {
    const own = this.#own();
    if (n <= own || this.#clock.now() < (this.#ignoredUntil.get(peer) ?? Number.NEGATIVE_INFINITY)) return false;
    const held = this.#held.get(peer);
    if (held === undefined) this.#hold(peer, n, own);
    else this.#held.set(peer, { ...held, n: Math.max(n, held.n) });
    return true;
  }

  /** Records were merged: a claim this host's own counter now meets resolves, one it moved toward runs 30 s more. */
  merged(): void {
    const own = this.#own();
    for (const [peer, held] of this.#held) {
      if (own <= held.own) continue;
      held.cancel();
      if (own >= held.n) this.#held.delete(peer);
      else this.#hold(peer, held.n, own);
    }
  }

  /** Whether `records` carry records of `self` above its own counter while a claim waits on them. */
  meets(records: readonly Signed[], self: string): boolean {
    if (this.#held.size === 0) return false;
    const own = this.#own();
    return records.some((record) => {
      const body = parseRecord(record);
      return body?.by === self && body.n > own;
    });
  }

  /** The highest claim standing, and whose it is. */
  floor(): Floor | undefined {
    let top: Floor | undefined;
    for (const [peer, held] of this.#held) if (top === undefined || held.n > top.n) top = { n: held.n, peer };
    return top;
  }

  stop(): void {
    for (const held of this.#held.values()) held.cancel();
    this.#held.clear();
  }

  #hold(peer: string, n: number, own: number): void {
    const cancel = deadline(this.#clock, CLAIM_MS, () => {
      const top = this.#held.get(peer)?.n ?? n;
      this.#held.delete(peer);
      this.#ignoredUntil.set(peer, this.#clock.now() + CLAIM_COOLDOWN_MS);
      this.#log(
        `mesh: ${this.#nameOf(peer)} claimed counter ${top} of this host's key and sent none of those records within 30 s: its claims are ignored for 10 minutes`,
      );
    });
    this.#held.set(peer, { n, own, cancel });
  }
}
