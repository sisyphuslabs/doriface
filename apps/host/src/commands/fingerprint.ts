import { fingerprintOf } from "@doriface/crypto";
import { parseArgs } from "node:util";
import { defaultStateDir } from "../state/files.ts";
import { loadHostIdentity } from "../state/host-keys.ts";

export const FINGERPRINT_USAGE = `usage: doriface-host fingerprint [--state-dir <dir>]

  prints the host fingerprint a device shows while pairing, to compare the two`;

/** Prints the host fingerprint (ten groups of four hex characters), creating the host keys on first use. */
export function fingerprintCommand(args: readonly string[], out: (text: string) => void): void {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: { "state-dir": { type: "string" }, help: { type: "boolean", short: "h", default: false } },
  });
  if (values.help) return out(`${FINGERPRINT_USAGE}\n`);
  const identity = loadHostIdentity(values["state-dir"] ?? defaultStateDir());
  out(`${fingerprintOf(identity.noise.publicKey)}\n`);
}
