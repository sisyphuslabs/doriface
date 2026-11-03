import { createPairingOffer, type PairingOffer, PairingGuard } from "@doriface/crypto";
import { join } from "node:path";
import { ensureStateDir, isRecord, readJson, removeFile, stringField, writePrivateJson } from "./files.ts";
import { withStateLock } from "./lock.ts";

const FILE = "pairing.json";

/** Where the typed code's relay slot stands: `pending` until the running host's uplink answers. */
export type SlotStatus = "pending" | "registered" | "unavailable";

export interface PendingPairing extends PairingOffer {
  readonly slot: SlotStatus;
}

export interface PairingClaim {
  readonly psk: Uint8Array;
  /**
   * The handshake completed: burns the code and returns whether this was its first success. It runs before the caller
   * stores the device, so a crash or a failed store can never leave the code usable. A failed handshake settles
   * nothing; a code ends only on success or expiry.
   */
  complete(): boolean;
}

/**
 * The one pending pairing offer (pairing.json, 0600). `doriface-host pair` writes it, replacing any earlier one; the
 * running host claims it per IKpsk2 handshake, registers its relay slot, and deletes it once used or expired.
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
    const pending = { ...createPairingOffer(now), slot: "pending" as const };
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
    if (this.#guard?.offer.code !== pending.code) this.#guard = new PairingGuard(pending);
    const guard = this.#guard;
    const psk = guard.claim(now);
    if (psk === undefined) {
      if (guard.state === "expired") this.#removeIf(pending.code);
      return undefined;
    }
    return {
      psk,
      complete: () => withStateLock(this.#dir, () => guard.use() && (this.#removeIfHeld(pending.code), true)),
    };
  }

  /** Deletes the offer once it expired, so its relay slot is released. */
  expire(now = Date.now()): void {
    const pending = this.read();
    if (pending !== undefined && now >= pending.expiresAt) this.#removeIf(pending.code);
  }

  read(): PendingPairing | undefined {
    const value = readJson(this.#path);
    if (value === undefined) return undefined;
    if (!isRecord(value) || value["version"] !== 2) throw new Error(`${FILE}: unsupported format`);
    const expiresAt = Date.parse(stringField(value, "expiresAt", FILE));
    const slot = value["slot"];
    if (Number.isNaN(expiresAt)) throw new Error(`${FILE}: malformed`);
    if (slot !== "pending" && slot !== "registered" && slot !== "unavailable") throw new Error(`${FILE}: bad slot`);
    return { code: stringField(value, "code", FILE), expiresAt, slot };
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

  #removeIf(code: string): void {
    withStateLock(this.#dir, () => this.#removeIfHeld(code));
  }

  /** Removes the offer if it still holds `code` (a newer `pair` may have replaced it); the caller holds the lock. */
  #removeIfHeld(code: string): void {
    if (this.read()?.code !== code) return;
    removeFile(this.#path);
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
