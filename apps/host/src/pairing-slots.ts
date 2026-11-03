import { pairingSlotOf } from "@doriface/crypto";
import type { PairingStore, PendingPairing } from "./state/pairing.ts";

/**
 * The relay side of typed-code pairing: the host uplink's PAIR_SLOT control frame (type 4, payload = the 3 ASCII slot
 * characters). The integration with the relay client supplies it; without one, typed codes are marked unavailable and
 * only the link or QR code pairs.
 */
export interface PairingSlotRegistrar {
  /**
   * Registers the slot with this host's Noise static key, sent as `encodePairSlot(slot, noiseStaticPub)`;
   * "collision" when the relay answers 409 because another host holds it.
   */
  register(slot: string, noiseStaticPub: Uint8Array): Promise<"registered" | "collision">;
  /** The offer behind the slot ended (paired, expired or replaced): send the empty PAIR_SLOT (`PAIR_SLOT_CLEAR`). */
  release?(slot: string): void;
}

const MAX_REDRAWS = 8;

/** Keeps the pending offer's slot registered with the relay, drawing a new code on a collision. */
export class PairingSlots {
  readonly #store: PairingStore;
  readonly #registrar: PairingSlotRegistrar | undefined;
  readonly #noiseStaticPub: Uint8Array;
  readonly #log: (line: string) => void;
  /** The code whose slot this instance registered; a `registered` status left by an earlier process is not ours. */
  #registered: string | undefined;
  #expiry: { readonly code: string; readonly timer: ReturnType<typeof setTimeout> } | undefined;
  #running: Promise<void> = Promise.resolve();
  #stopWatch: (() => void) | undefined;
  #stopped = false;

  constructor(
    store: PairingStore,
    noiseStaticPub: Uint8Array,
    registrar: PairingSlotRegistrar | undefined,
    log: (line: string) => void,
  ) {
    this.#store = store;
    this.#noiseStaticPub = noiseStaticPub;
    this.#registrar = registrar;
    this.#log = log;
  }

  /** Follows the store's own changes and registers an offer left by `pair` while no host ran. */
  start(): void {
    this.#stopped = false;
    this.#stopWatch ??= this.#store.onChange(() => this.sync());
    this.sync();
  }

  /** Opens a new offer (replacing any pending one) and resolves once its slot is settled with the relay. */
  async open(): Promise<PendingPairing> {
    const offer = this.#store.offer();
    this.sync();
    await this.#running;
    return this.#store.read() ?? offer;
  }

  /** Stops following the store; a registration still in flight is released when it answers. */
  stop(): void {
    this.#stopped = true;
    this.#stopWatch?.();
    this.#stopWatch = undefined;
    this.#disarm();
    this.#release();
  }

  /** Re-reads the offer and brings the relay in line; runs one sync at a time. */
  sync(): void {
    this.#running = this.#running
      .then(() => this.#sync())
      .catch((error: unknown) => this.#log(`pairing slot: ${String(error)}`));
  }

  async #sync(): Promise<void> {
    if (this.#stopped) return;
    const pending = this.#store.read();
    const live = pending !== undefined && Date.now() < pending.expiresAt;
    if (!live || pending.code !== this.#registered) this.#release();
    if (!live) {
      this.#disarm();
      return this.#store.expire();
    }
    this.#arm(pending);
    if (pending.slot === "unavailable" || (pending.slot === "registered" && pending.code === this.#registered)) return;
    if (this.#registrar === undefined) return this.#store.setSlot(pending.code, "unavailable");
    return this.#register(this.#registrar, pending, 0);
  }

  async #register(registrar: PairingSlotRegistrar, pending: PendingPairing, redraws: number): Promise<void> {
    if (redraws >= MAX_REDRAWS) return this.#store.setSlot(pending.code, "unavailable");
    const slot = pairingSlotOf(pending.code);
    const answer = await registrar.register(slot, this.#noiseStaticPub);
    if (this.#stopped) {
      if (answer === "registered") registrar.release?.(slot);
      return;
    }
    if (answer === "registered") {
      this.#registered = pending.code;
      return this.#store.setSlot(pending.code, "registered");
    }
    const next = this.#store.redraw(pending.code);
    if (next === undefined || next.slot !== "pending") return;
    return this.#register(registrar, next, redraws + 1);
  }

  /** Re-syncs when the live offer expires, whether or not its slot is registered. */
  #arm(pending: PendingPairing): void {
    if (this.#expiry?.code === pending.code) return;
    this.#disarm();
    const timer = setTimeout(() => this.sync(), Math.max(0, pending.expiresAt - Date.now()));
    this.#expiry = { code: pending.code, timer };
  }

  #disarm(): void {
    if (this.#expiry !== undefined) clearTimeout(this.#expiry.timer);
    this.#expiry = undefined;
  }

  #release(): void {
    const registered = this.#registered;
    if (registered === undefined) return;
    this.#registered = undefined;
    this.#registrar?.release?.(pairingSlotOf(registered));
  }
}
