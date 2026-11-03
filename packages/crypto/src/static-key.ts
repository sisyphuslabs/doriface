import { x25519 } from "@noble/curves/ed25519.js";
import type { KeyPair } from "./identity.ts";

/**
 * The local Noise static key as the handshake uses it: the public half and a Diffie-Hellman with a peer key. The
 * private half may live outside JavaScript (a non-extractable WebCrypto key), so the DH is async.
 */
export interface StaticKey {
  readonly publicKey: Uint8Array;
  dh(remotePublic: Uint8Array): Promise<Uint8Array>;
}

/** A static key held as raw bytes (the host), using @noble's X25519; low-order peer keys are rejected. */
export const rawStaticKey = (pair: KeyPair): StaticKey => ({
  publicKey: pair.publicKey,
  dh: (remotePublic) => Promise.resolve(x25519.getSharedSecret(pair.secretKey, remotePublic)),
});

const X25519 = { name: "X25519" } as const;

/** Whether this runtime's WebCrypto can generate X25519 keys and derive bits with them. */
export async function supportsWebCryptoX25519(): Promise<boolean> {
  try {
    await generateWebCryptoStaticKey();
    return true;
  } catch {
    return false;
  }
}

/** A static key over a WebCrypto X25519 private key, which may be non-extractable. */
export function webCryptoStaticKey(privateKey: CryptoKey, publicKey: Uint8Array): StaticKey {
  return {
    publicKey,
    async dh(remotePublic) {
      const peer = await crypto.subtle.importKey("raw", Uint8Array.from(remotePublic), X25519, true, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peer }, privateKey, 256));
      if (shared.every((byte) => byte === 0)) throw new Error("X25519 produced an all-zero shared secret");
      return shared;
    },
  };
}

/**
 * Generates a non-extractable WebCrypto X25519 key (the private half can be stored in IndexedDB as a CryptoKey but
 * never read back as bytes) and wraps it as a {@link StaticKey}.
 */
export async function generateWebCryptoStaticKey(): Promise<{
  readonly privateKey: CryptoKey;
  readonly staticKey: StaticKey;
}> {
  const pair = await crypto.subtle.generateKey(X25519, false, ["deriveBits"]);
  if (!("privateKey" in pair)) throw new Error("X25519 generateKey returned a single key");
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, staticKey: webCryptoStaticKey(pair.privateKey, publicKey) };
}
