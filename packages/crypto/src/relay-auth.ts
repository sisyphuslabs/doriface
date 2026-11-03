import { ed25519 } from "@noble/curves/ed25519.js";
import { concatBytes, utf8 } from "./encoding.ts";
import { type HostIdentity, hostIdOf } from "./identity.ts";

/**
 * The origin a host signs its uplink for: `wss://host[:port]` (or `ws://` for a plain local relay) of the URL it dials.
 * Binding it stops a relay the host also uses from replaying the host's answer to another relay's challenge.
 */
export function relayOriginOf(relayUrl: string): string {
  const url = new URL(relayUrl);
  const scheme = { "https:": "wss:", "wss:": "wss:", "http:": "ws:", "ws:": "ws:" }[url.protocol];
  if (scheme === undefined) throw new Error(`a relay URL is http(s) or ws(s), got ${url.protocol}`);
  return `${scheme}//${url.host}`;
}

/** The bytes the uplink signature covers: `doriface-relay-v1` || relayOrigin || hostId || challenge. */
export const relayChallengeMessage = (relayOrigin: string, hostId: string, challenge: Uint8Array): Uint8Array =>
  concatBytes(utf8("doriface-relay-v1"), utf8(relayOrigin), utf8(hostId), challenge);

/** The host's answer to a relay challenge: signPub (32) || Ed25519 signature (64). */
export const signRelayChallenge = (identity: HostIdentity, relayOrigin: string, challenge: Uint8Array): Uint8Array =>
  concatBytes(
    identity.sign.publicKey,
    ed25519.sign(relayChallengeMessage(relayOrigin, identity.hostId, challenge), identity.sign.secretKey),
  );

/** The relay's check: the answer is 96 bytes, its key hashes to `hostId`, and it signs this origin and challenge. */
export function verifyRelayAnswer(
  relayOrigin: string,
  hostId: string,
  challenge: Uint8Array,
  answer: Uint8Array,
): boolean {
  if (answer.byteLength !== 96) return false;
  const signPub = answer.subarray(0, 32);
  if (hostIdOf(signPub) !== hostId) return false;
  return ed25519.verify(answer.subarray(32), relayChallengeMessage(relayOrigin, hostId, challenge), signPub);
}
