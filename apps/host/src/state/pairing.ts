import { createPairingOffer, type PairingOffer, PairingGuard } from "@doriface/crypto";
import { join } from "node:path";
import { ensureStateDir, isRecord, readJson, removeFile, stringField, writePrivateJson } from "./files.ts";
import { withStateLock } from "./lock.ts";

const FILE = "pairing.json";

/** Where the typed code's relay slot stands: `pending` until the running host's uplink answers. */
export type SlotStatus = "pending" | "registered" | "unavailable";

export interface PendingPairing extends PairingOffer {
  readonly failures: number;
  readonly slot: SlotStatus;
}

export interface PairingClaim {
  readonly psk: Uint8Array;
  /**
   * `true`: the handshake completed; burns the code and returns whether this was its first success, before the caller
   * stores the device, so a crash or a failed store can never leave the code usable. `false`: counts a failed
   * attempt (the third burns the code). Returns false for a failure.
   */
  settle(paired: boolean): boolean;
}

/**
 * The one pending pairing offer (pairing.json, 0600). `doriface-host pair` writes it, replacing any earlier one; the
 * running host claims it per IKpsk2 handshake, registers its relay slot, and deletes it once used or burned.
 */
export class PairingStore {
  readonly #dir: string;
  readonly #path: string;
  #guard: PairingGuard | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(stateDir: string) {
    this.#dir = ensureStateDir(stateDir);
    this.#path = join(this.#dir, FILE);
  }

  offer(now = Date.now()): PendingPairing {
    const pending = { ...createPairingOffer(now), failures: 0, slot: "pending" as const };
    withStateLock(this.#dir, () => this.#write(pending));
    return pending;
  }

  /** Replaces the code of the pending offer after a relay slot collision; keeps its expiry. */
  redraw(code: string): PendingPairing | undefined {
    return withStateLock(this.#dir, () => {
      const current = this.read();
      if (current === undefined || current.code !== code) return current;
      const next = { ...current, code: createPairingOffer().code, slot: "pending" as const };
      this.#write(next);
      return next;
    });
  }

  setSlot(code: string, slot: SlotStatus): void {
    withStateLock(this.#dir, () => {
      const current = this.read();
      if (current?.code === code && current.slot !== slot) this.#write({ ...current, slot });
    });
  }

  claim(now = Date.now()): PairingClaim | undefined {
    const pending = this.read();
    if (pending === undefined) return undefined;
    if (this.#guard?.offer.code !== pending.code) this.#guard = new PairingGuard(pending, pending.failures);
    const guard = this.#guard;
    const psk = guard.claim(now);
    if (psk === undefined) return undefined;
    return {
      psk,
      settle: (paired) =>
        withStateLock(this.#dir, () => {
          const first = paired ? guard.use() : (guard.fail(), false);
          const current = this.read();
          if (current?.code !== pending.code) return first;
          if (guard.state === "open") this.#write({ ...current, failures: guard.failures });
          else this.#remove();
          return first;
        }),
    };
  }

  read(): PendingPairing | undefined {
    const value = readJson(this.#path);
    if (value === undefined) return undefined;
    if (!isRecord(value) || value["version"] !== 2) throw new Error(`${FILE}: unsupported format`);
    const expiresAt = Date.parse(stringField(value, "expiresAt", FILE));
    const failures = value["failures"];
    const slot = value["slot"];
    if (Number.isNaN(expiresAt) || typeof failures !== "number") throw new Error(`${FILE}: malformed`);
    if (slot !== "pending" && slot !== "registered" && slot !== "unavailable") throw new Error(`${FILE}: bad slot`);
    return { code: stringField(value, "code", FILE), expiresAt, failures, slot };
  }

  /** Reports every change this store makes (a pairing used up or burned, a code redrawn). */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #write(pending: PendingPairing): void {
    writePrivateJson(this.#path, { version: 2, ...pending, expiresAt: new Date(pending.expiresAt).toISOString() });
    this.#changed();
  }

  #remove(): void {
    removeFile(this.#path);
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
