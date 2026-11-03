import { ed25519 } from "@noble/curves/ed25519.js";

/** Signs relay challenges with the host's Ed25519 key. */
export interface HostSigner {
  readonly publicKey: Uint8Array<ArrayBuffer>;
  sign(message: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export function generateSigningKey(): Uint8Array {
  return ed25519.utils.randomSecretKey();
}

export function ed25519Signer(secretKey: Uint8Array): HostSigner {
  const key = secretKey.slice();
  const publicKey = new Uint8Array(ed25519.getPublicKey(key));
  return { publicKey, sign: (message) => ed25519.sign(message, key) };
}
