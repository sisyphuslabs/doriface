import { LinkClosedError } from "./link.ts";
import { decodePairSlotAck, PairSlotAckStatus } from "./wire/index.ts";

export type PairSlotResult = "registered" | "taken";

/** The relay acked a PAIR_SLOT request Malformed: for the signed form, a relay older than contract v1.9 (#22). */
export class PairSlotMalformedError extends Error {
  override readonly name = "PairSlotMalformedError";
}

interface Waiter {
  readonly resolvers: PromiseWithResolvers<PairSlotResult>;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * PAIR_SLOT requests the uplink sent, waiting for the relay's PAIR_SLOT_ACK. At most one request per slot waits at a
 * time, and one without a reply in `timeoutMs` is dropped, so a lost reply never blocks later requests.
 */
export class PairSlotRequests {
  readonly #waiting = new Map<string, Waiter>();

  wait(slot: string, timeoutMs: number): Promise<PairSlotResult> {
    if (this.#waiting.has(slot)) {
      return Promise.reject(new Error(`a PAIR_SLOT request for ${slot} is already waiting for the relay`));
    }
    const resolvers = Promise.withResolvers<PairSlotResult>();
    const timer = setTimeout(() => {
      this.#waiting.delete(slot);
      resolvers.reject(new Error(`no PAIR_SLOT reply for ${slot} within ${timeoutMs} ms`));
    }, timeoutMs);
    this.#waiting.set(slot, { resolvers, timer });
    return resolvers.promise;
  }

  /** Settles the request a PAIR_SLOT_ACK payload answers; false when the ack itself is malformed. */
  settle(payload: Uint8Array): boolean {
    const ack = decodePairSlotAck(payload);
    if (ack === undefined) return false;
    const waiter = this.#waiting.get(ack.slot);
    this.#waiting.delete(ack.slot);
    if (waiter === undefined) return true;
    clearTimeout(waiter.timer);
    if (ack.status === PairSlotAckStatus.Malformed) {
      waiter.resolvers.reject(
        new PairSlotMalformedError(`the relay refused the PAIR_SLOT request for ${ack.slot} as malformed`),
      );
    } else {
      waiter.resolvers.resolve(ack.status === PairSlotAckStatus.Registered ? "registered" : "taken");
    }
    return true;
  }

  failAll(reason: string): void {
    for (const { resolvers, timer } of this.#waiting.values()) {
      clearTimeout(timer);
      resolvers.reject(new LinkClosedError(reason));
    }
    this.#waiting.clear();
  }
}
