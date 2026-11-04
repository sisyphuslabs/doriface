import { hashOf, type Signed } from "@doriface/mesh";
import { missingSince } from "./anti-entropy.ts";

/** What each peer is known to hold (section 5.3: owed is what it is not known to hold). */
export class Confirmed {
  readonly #records: () => readonly Signed[];
  readonly #held = new Map<string, readonly string[]>();

  constructor(records: () => readonly Signed[]) {
    this.#records = records;
  }

  /** The heads the peer's `hello` named. */
  heard(peer: string, heads: readonly string[]): void {
    this.#held.set(peer, heads);
  }

  /**
   * A stored record a peer sent, and its past, is one it holds. Only stored hashes are kept, as the session's own set
   * does: refused ones would grow it without bound.
   */
  sent(peer: string, batch: readonly Signed[]): void {
    const stored = new Set(this.#records().map(hashOf));
    const held = batch.map(hashOf).filter((hash) => stored.has(hash));
    this.#held.set(peer, [...new Set([...this.held(peer), ...held])]);
  }

  /** The heads and records `peer` is known to hold: its last `hello`, and the stored records it sent since. */
  held(peer: string): readonly string[] {
    return this.#held.get(peer) ?? [];
  }

  /** How many stored records `peer` is not known to hold. */
  owedCount(peer: string): number {
    return missingSince(this.#records(), this.held(peer)).length;
  }
}
