import { base64urlDecode, base64urlEncode, fingerprintOf } from "@doriface/crypto";
import { join } from "node:path";
import { ensureStateDir, isRecord, readJson, stringField, writePrivateJson } from "./files.ts";

const FILE = "devices.json";

export interface PairedDevice {
  /** base64url of the device's X25519 static public key. */
  readonly clientStaticPub: string;
  readonly name: string;
  /** ISO 8601. */
  readonly pairedAt: string;
}

/** A short handle for a device: the first two groups of its key's fingerprint, e.g. `3FA94C0E`. */
export const deviceIdOf = (device: PairedDevice): string =>
  fingerprintOf(base64urlDecode(device.clientStaticPub)).replaceAll(" ", "").slice(0, 8);

/**
 * The paired-devices file (0600 JSON). Every read goes to disk, so a `doriface-host devices revoke` run by another
 * process takes effect on the next handshake.
 */
export class DeviceStore {
  readonly #path: string;

  constructor(stateDir: string) {
    this.#path = join(ensureStateDir(stateDir), FILE);
  }

  list(): readonly PairedDevice[] {
    const value = readJson(this.#path);
    if (value === undefined) return [];
    if (!isRecord(value) || !Array.isArray(value["devices"])) throw new Error(`${FILE}: unsupported format`);
    return value["devices"].map((entry: unknown) => {
      if (!isRecord(entry)) throw new Error(`${FILE}: a device entry is not an object`);
      return {
        clientStaticPub: stringField(entry, "clientStaticPub", FILE),
        name: stringField(entry, "name", FILE),
        pairedAt: stringField(entry, "pairedAt", FILE),
      };
    });
  }

  has(clientStaticPub: Uint8Array): boolean {
    const key = base64urlEncode(clientStaticPub);
    return this.list().some((device) => device.clientStaticPub === key);
  }

  /** Records a newly paired device, replacing an earlier entry for the same key. */
  add(clientStaticPub: Uint8Array, name: string, now = new Date()): PairedDevice {
    const device = { clientStaticPub: base64urlEncode(clientStaticPub), name, pairedAt: now.toISOString() };
    const others = this.list().filter((entry) => entry.clientStaticPub !== device.clientStaticPub);
    this.#save([...others, device]);
    return device;
  }

  /** Removes the devices whose id (or full base64url key) is `handle`; returns what was removed. */
  revoke(handle: string): readonly PairedDevice[] {
    const devices = this.list();
    const id = handle.replaceAll(" ", "").toUpperCase();
    const removed = devices.filter((device) => deviceIdOf(device) === id || device.clientStaticPub === handle);
    if (removed.length > 0) this.#save(devices.filter((device) => !removed.includes(device)));
    return removed;
  }

  #save(devices: readonly PairedDevice[]): void {
    writePrivateJson(this.#path, { version: 1, devices });
  }
}
