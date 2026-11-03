import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { blake2s } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base32Encode, concatBytes, utf8 } from "./encoding.ts";

/** A Curve25519 key pair: X25519 for Noise statics, Ed25519 for the host signing key. */
export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export interface HostIdentity {
  readonly hostId: string;
  readonly sign: KeyPair;
  readonly noise: KeyPair;
}

export const generateX25519 = (): KeyPair => x25519.keygen();
export const x25519FromSecret = (secretKey: Uint8Array): KeyPair => ({
  publicKey: x25519.getPublicKey(secretKey),
  secretKey,
});

export const generateEd25519 = (): KeyPair => ed25519.keygen();
export const ed25519FromSecret = (secretKey: Uint8Array): KeyPair => ({
  publicKey: ed25519.getPublicKey(secretKey),
  secretKey,
});

/** base32 of the first 16 bytes of SHA-256(signPub): 26 characters. */
export const hostIdOf = (signPub: Uint8Array): string => base32Encode(sha256(signPub).subarray(0, 16));

/** base32 of the first 20 bytes of BLAKE2s(noiseStaticPub), as four groups of eight characters. */
export function fingerprintOf(noiseStaticPub: Uint8Array): string {
  const text = base32Encode(blake2s(noiseStaticPub).subarray(0, 20));
  return [0, 8, 16, 24].map((start) => text.slice(start, start + 8)).join(" ");
}

export function hostIdentityFromSecrets(signSecret: Uint8Array, noiseSecret: Uint8Array): HostIdentity {
  const sign = ed25519FromSecret(signSecret);
  return { hostId: hostIdOf(sign.publicKey), sign, noise: x25519FromSecret(noiseSecret) };
}

export function generateHostIdentity(): HostIdentity {
  return hostIdentityFromSecrets(generateEd25519().secretKey, generateX25519().secretKey);
}

/** The Noise prologue for both patterns: UTF-8 `doriface/1` followed by the UTF-8 hostId. */
export const prologueFor = (hostId: string): Uint8Array => concatBytes(utf8("doriface/1"), utf8(hostId));

/** The bytes a relay challenge signature covers: `doriface-relay-v1` || hostId || challenge. */
export const relayChallengeMessage = (hostId: string, challenge: Uint8Array): Uint8Array =>
  concatBytes(utf8("doriface-relay-v1"), utf8(hostId), challenge);

export const signRelayChallenge = (identity: HostIdentity, challenge: Uint8Array): Uint8Array =>
  concatBytes(
    identity.sign.publicKey,
    ed25519.sign(relayChallengeMessage(identity.hostId, challenge), identity.sign.secretKey),
  );

export function verifyRelayAnswer(hostId: string, challenge: Uint8Array, answer: Uint8Array): boolean {
  if (answer.byteLength !== 96) return false;
  const signPub = answer.subarray(0, 32);
  if (hostIdOf(signPub) !== hostId) return false;
  return ed25519.verify(answer.subarray(32), relayChallengeMessage(hostId, challenge), signPub);
}
