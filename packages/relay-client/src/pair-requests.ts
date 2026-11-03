import { LinkClosedError } from "./link.ts";
import { decodePairSlotReply, PairSlotStatus } from "./wire/index.ts";

export type PairSlotResult = "registered" | "taken";

/** PAIR_SLOT requests the uplink sent, waiting for the relay's 200 or 409, one per slot. */
export class PairSlotRequests {
  readonly #waiting = new Map<string, PromiseWithResolvers<PairSlotResult>>();

  wait(slot: string): Promise<PairSlotResult> {
    const pending = this.#waiting.get(slot) ?? Promise.withResolvers<PairSlotResult>();
    this.#waiting.set(slot, pending);
    return pending.promise;
  }

  /** Settles the request a reply answers; false when the reply is malformed. */
  settle(payload: Uint8Array): boolean {
    const reply = decodePairSlotReply(payload);
    if (reply === undefined) return false;
    this.#waiting.get(reply.slot)?.resolve(reply.status === PairSlotStatus.Registered ? "registered" : "taken");
    this.#waiting.delete(reply.slot);
    return true;
  }

  failAll(reason: string): void {
    for (const pending of this.#waiting.values()) pending.reject(new LinkClosedError(reason));
    this.#waiting.clear();
  }
}
