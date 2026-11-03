import { createPairingOffer, type PairingOffer, PairingSlot } from "@doriface/crypto";
import { join } from "node:path";
import { ensureStateDir, isRecord, readJson, removeFile, stringField, writePrivateJson } from "./files.ts";

const FILE = "pairing.json";

export interface PairingClaim {
  readonly psk: Uint8Array;
  /** Burns the code after a completed pairing, or reopens it after a failed attempt. */
  settle(paired: boolean): void;
}

/**
 * The one pending pairing offer. `doriface-host pair` writes it (replacing any earlier one); the running host claims
 * it per IKpsk2 handshake and deletes the file once a device paired, so a code works once and only for 10 minutes.
 */
export class PairingStore {
  readonly #path: string;
  #slot: PairingSlot | undefined;

  constructor(stateDir: string) {
    this.#path = join(ensureStateDir(stateDir), FILE);
  }

  offer(now = Date.now()): PairingOffer {
    const offer = createPairingOffer(now);
    writePrivateJson(this.#path, { version: 1, code: offer.code, expiresAt: new Date(offer.expiresAt).toISOString() });
    return offer;
  }

  claim(now = Date.now()): PairingClaim | undefined {
    const offer = this.#read();
    if (offer === undefined) return undefined;
    if (this.#slot?.offer.code !== offer.code) this.#slot = new PairingSlot(offer);
    const slot = this.#slot;
    const psk = slot.claim(now);
    if (psk === undefined) return undefined;
    return {
      psk,
      settle: (paired) => {
        if (!paired) return slot.release();
        slot.burn();
        if (this.#read()?.code === slot.offer.code) removeFile(this.#path);
      },
    };
  }

  #read(): PairingOffer | undefined {
    const value = readJson(this.#path);
    if (value === undefined) return undefined;
    if (!isRecord(value) || value["version"] !== 1) throw new Error(`${FILE}: unsupported format`);
    const expiresAt = Date.parse(stringField(value, "expiresAt", FILE));
    if (Number.isNaN(expiresAt)) throw new Error(`${FILE}: expiresAt is not a date`);
    return { code: stringField(value, "code", FILE), expiresAt };
  }
}
