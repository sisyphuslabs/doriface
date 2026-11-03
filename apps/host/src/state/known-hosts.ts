import { base64urlDecode, base64urlEncode, generateX25519, type KeyPair, x25519FromSecret } from "@doriface/crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { createPrivateJson, ensureStateDir, isRecord, readJson, stringField, writePrivateJson } from "./files.ts";

const DEVICE_FILE = "device-key.json";
const HOSTS_FILE = "known-hosts.json";

export interface KnownHost {
  readonly hostId: string;
  /** The host's Noise static public key. */
  readonly hostKey: Uint8Array;
  readonly relayUrl: string;
}

/**
 * This machine's X25519 device key, generated and saved (0600) on first use. Like the host keys, a file others can
 * read is refused rather than tightened.
 */
export function loadDeviceKey(stateDir: string): KeyPair {
  const path = join(ensureStateDir(stateDir), DEVICE_FILE);
  const existing = readJson(path);
  if (existing !== undefined) {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `${path} is readable by other users (mode ${mode.toString(8)}): chmod 600 it, or delete it and pair again`,
      );
    }
    return parseDevice(existing);
  }
  const key = generateX25519();
  const created = createPrivateJson(path, { version: 1, secret: base64urlEncode(key.secretKey) });
  return created ? key : parseDevice(readJson(path));
}

function parseDevice(value: unknown): KeyPair {
  if (!isRecord(value) || value["version"] !== 1) throw new Error(`${DEVICE_FILE}: unsupported format`);
  return x25519FromSecret(base64urlDecode(stringField(value, "secret", DEVICE_FILE)));
}

export class KnownHosts {
  readonly #path: string;

  constructor(stateDir: string) {
    this.#path = join(ensureStateDir(stateDir), HOSTS_FILE);
  }

  get(hostId: string): KnownHost | undefined {
    return this.#read().find((host) => host.hostId === hostId);
  }

  add(host: KnownHost): void {
    const others = this.#read().filter((known) => known.hostId !== host.hostId);
    const hosts = [...others, host].map(({ hostId, hostKey, relayUrl }) => ({
      hostId,
      hostKey: base64urlEncode(hostKey),
      relayUrl,
    }));
    writePrivateJson(this.#path, { version: 1, hosts });
  }

  #read(): KnownHost[] {
    const value = readJson(this.#path);
    if (value === undefined) return [];
    if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["hosts"])) {
      throw new Error(`${HOSTS_FILE}: unsupported format`);
    }
    return value["hosts"].map((entry: unknown) => {
      if (!isRecord(entry)) throw new Error(`${HOSTS_FILE}: a host entry is not an object`);
      return {
        hostId: stringField(entry, "hostId", HOSTS_FILE),
        hostKey: base64urlDecode(stringField(entry, "hostKey", HOSTS_FILE)),
        relayUrl: stringField(entry, "relayUrl", HOSTS_FILE),
      };
    });
  }
}
