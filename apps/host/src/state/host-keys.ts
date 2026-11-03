import {
  base64urlDecode,
  base64urlEncode,
  generateHostIdentity,
  type HostIdentity,
  hostIdentityFromSecrets,
} from "@doriface/crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { createPrivateJson, ensureStateDir, isRecord, readJson, stringField } from "./files.ts";

const FILE = "host-keys.json";

/**
 * Loads the host's Ed25519 signing key and X25519 Noise key, generating and saving them (0600) on first use. A file
 * that group or others can read is refused rather than tightened: its keys may already have been copied, and only the
 * operator can decide whether to keep them.
 */
export function loadHostIdentity(stateDir: string): HostIdentity {
  const path = join(ensureStateDir(stateDir), FILE);
  const existing = readJson(path);
  if (existing !== undefined) {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `${path} is readable by other users (mode ${mode.toString(8)}): chmod 600 it, or delete it for new host keys (every device then pairs again)`,
      );
    }
    return parse(existing);
  }
  const identity = generateHostIdentity();
  const created = createPrivateJson(path, {
    version: 1,
    signSecret: base64urlEncode(identity.sign.secretKey),
    noiseSecret: base64urlEncode(identity.noise.secretKey),
  });
  return created ? identity : parse(readJson(path));
}

function parse(value: unknown): HostIdentity {
  if (!isRecord(value) || value["version"] !== 1) throw new Error(`${FILE}: unsupported format`);
  return hostIdentityFromSecrets(
    base64urlDecode(stringField(value, "signSecret", FILE)),
    base64urlDecode(stringField(value, "noiseSecret", FILE)),
  );
}
