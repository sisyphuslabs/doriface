import { hkdf } from "@noble/hashes/hkdf.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { lvCat } from "./cpace.ts";
import { utf8 } from "./encoding.ts";
import { LINK_SECRET_LENGTH, normalizePairingCode, pairingSlotOf } from "./pairing.ts";

const EMPTY = new Uint8Array(0);

/** CPace CI for a typed code: the role labels, the host's identity and Noise static key, and the slot. */
export const codePairingCi = (hostId: string, noiseStaticPub: Uint8Array, slot: string): Uint8Array =>
  lvCat(
    utf8("doriface/1.3 CPace pair-code"),
    utf8("A=device"),
    utf8("B=host"),
    utf8(hostId),
    noiseStaticPub,
    utf8(slot),
  );

/** CPace PRS and CI for `code`, typed for the host `hostId` whose Noise static key is `noiseStaticPub`. */
export function codePairingInputs(code: string, hostId: string, noiseStaticPub: Uint8Array) {
  const canonical = normalizePairingCode(code);
  return { prs: utf8(canonical), ci: codePairingCi(hostId, noiseStaticPub, pairingSlotOf(canonical)) };
}

/** The IKpsk2 psk of a typed-code pairing: HKDF-SHA512 of the CPace ISK. */
export const codePairingPsk = (isk: Uint8Array): Uint8Array =>
  hkdf(sha512, isk, EMPTY, utf8("doriface/1.3 pair-code psk"), 32);

/** The IKpsk2 psk of a link pairing: HKDF-SHA512 of the link secret, bound to the host's identity and key. */
export function linkPairingPsk(linkSecret: Uint8Array, hostId: string, noiseStaticPub: Uint8Array): Uint8Array {
  if (linkSecret.byteLength !== LINK_SECRET_LENGTH) throw new RangeError("a link secret is 32 bytes");
  return hkdf(sha512, linkSecret, EMPTY, lvCat(utf8("doriface/1.3 pair-link psk"), utf8(hostId), noiseStaticPub), 32);
}
