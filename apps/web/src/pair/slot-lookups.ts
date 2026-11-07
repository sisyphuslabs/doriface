import { slotOf } from "./code.ts";
import type { PairingParse } from "./fragment.ts";
import { lookupSlot, offerFromSlot, type SlotAnswer } from "./lookup.ts";

type Lookup = (slot: string, relayUrl: string, signal?: AbortSignal) => Promise<SlotAnswer>;

/**
 * The relay's answer for the slot being typed. A slot is the code's first 3 characters, so its lookup starts as soon as
 * they are typed and runs while the other 5 are (#1271): the relay's first answer for a slot takes most of a second
 * from far away, and Pair then finds it waiting. One lookup per slot, never one more than Pair alone made: a slot that
 * changes cancels the lookup it no longer needs, and only a refusal is asked again, as a second Pair always did.
 */
export class SlotLookups {
  readonly #relayUrl: string;
  readonly #lookup: Lookup;
  #slot: string | null = null;
  #answer: Promise<SlotAnswer> | null = null;
  #refused = false;
  #abort: AbortController | null = null;

  constructor(relayUrl: string, lookup: Lookup = lookupSlot) {
    this.#relayUrl = relayUrl;
    this.#lookup = lookup;
  }

  /** The code field changed: looks its slot up once the slot is typed and differs from the one asked for. */
  typed(slot: string | null): void {
    if (slot !== null && slot !== this.#slot) this.#ask(slot);
  }

  /** The offer for a whole code, from its slot's lookup when one was made and did not refuse, else from a new one. */
  async offer(code: string): Promise<PairingParse> {
    const slot = slotOf(code);
    const asked = slot === this.#slot && !this.#refused ? this.#answer : null;
    return offerFromSlot(await (asked ?? this.#ask(slot)), code, this.#relayUrl);
  }

  #ask(slot: string): Promise<SlotAnswer> {
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    this.#slot = slot;
    this.#refused = false;
    const answer = this.#lookup(slot, this.#relayUrl, abort.signal);
    this.#answer = answer;
    void answer.then((settled) => {
      if (this.#answer === answer && !settled.ok) this.#refused = true;
      return settled;
    });
    return answer;
  }
}
