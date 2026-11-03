import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8 } from "./encoding.ts";

/**
 * CPace, cipher suite CPACE-RISTR255-SHA512 of draft-irtf-cfrg-cpace-21 (section 8.3), initiator-responder mode.
 * Every function follows the draft exactly; the vectors in `vectors/cpace-ristretto255-sha512.json` pin it.
 */
export const CPACE_SUITE = "CPACE-RISTR255-SHA512";

const DSI = utf8("CPaceRistretto255");
const DSI_ISK = utf8("CPaceRistretto255_ISK");
/** SHA-512's input block size, `H.s_in_bytes`. */
const S_IN_BYTES = 128;
const EMPTY = new Uint8Array(0);

type Point = ReturnType<typeof ristretto255.Point.fromBytes>;

/** Draft A.1.1: the length in LEB128, then the bytes. */
export function prependLen(data: Uint8Array): Uint8Array {
  const length: number[] = [];
  let rest = data.byteLength;
  do {
    const low = rest & 0x7f;
    rest >>>= 7;
    length.push(rest === 0 ? low : low | 0x80);
  } while (rest !== 0);
  return concatBytes(Uint8Array.from(length), data);
}

/** Draft A.1.3: every field with its length prepended, concatenated. */
export const lvCat = (...fields: readonly Uint8Array[]): Uint8Array => concatBytes(...fields.map(prependLen));

/** Draft 7.2: `lv_cat(DSI, PRS, zero_bytes(len_zpad), CI, sid)`, padding PRS to a hash block. */
export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array {
  const zpad = Math.max(0, S_IN_BYTES - prependLen(prs).byteLength - prependLen(DSI).byteLength - 1);
  return lvCat(DSI, prs, new Uint8Array(zpad), ci, sid);
}

/** Draft 8.3: the RFC 9496 element derivation of the generator string's SHA-512. */
export function cpaceGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Point {
  const derive = ristretto255_hasher.deriveToCurve;
  if (derive === undefined) throw new Error("this @noble/curves has no ristretto255 element derivation");
  return derive(sha512(generatorString(prs, ci, sid)));
}

const scalarOf = (bytes: Uint8Array): bigint => bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n);

/**
 * Draft 8.3: 32 random bytes with the bits above 252 cleared, read little-endian, so the scalar is below the group
 * order; a zero is drawn again, since a zero scalar would give the identity.
 */
export function sampleScalar(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): bigint {
  const bytes = random(new Uint8Array(32));
  bytes[31] = (bytes[31] ?? 0) & 0x0f;
  const scalar = scalarOf(bytes);
  return scalar === 0n ? sampleScalar(random) : scalar;
}

/** Draft 8.3 `scalar_mult_vfy`: an invalid encoding, the identity, or an identity result aborts the run. */
export function scalarMultVfy(scalar: bigint, encoded: Uint8Array): Uint8Array {
  let point: Point;
  try {
    point = ristretto255.Point.fromBytes(encoded);
  } catch (error) {
    throw new CpaceError("the peer's CPace share is not a ristretto255 encoding", { cause: error });
  }
  if (point.is0()) throw new CpaceError("the peer's CPace share is the identity");
  const shared = point.multiply(scalar);
  if (shared.is0()) throw new CpaceError("the CPace secret point is the identity");
  return shared.toBytes();
}

/** Draft 7.2/8.3, initiator-responder transcript: `H(lv_cat(DSI_ISK, sid, K) || lv_cat(Ya, ADa) || lv_cat(Yb, ADb))`. */
export const cpaceIsk = (
  sid: Uint8Array,
  k: Uint8Array,
  ya: Uint8Array,
  ada: Uint8Array,
  yb: Uint8Array,
  adb: Uint8Array,
): Uint8Array => sha512(concatBytes(lvCat(DSI_ISK, sid, k), lvCat(ya, ada), lvCat(yb, adb)));

export class CpaceError extends Error {
  override readonly name = "CpaceError";
}

/** What both sides share before a run: the password string, the channel identifier and the session id. */
export interface CpaceInputs {
  readonly prs: Uint8Array;
  readonly ci: Uint8Array;
  readonly sid: Uint8Array;
}

/** For tests only (not exported from the package): a fixed scalar instead of a random one. */
export interface CpaceTestOptions {
  readonly scalar?: bigint;
}

/** Throws unless `share` decodes to a ristretto255 element other than the identity (draft 8.3.1). */
export function assertCpaceShare(share: Uint8Array): void {
  scalarMultVfy(1n, share);
}

/**
 * The initiator (A): its share now, the 64-byte ISK once the responder's share arrives. ADa and ADb are empty.
 * `finish` throws a {@link CpaceError} on an invalid share.
 */
export function cpaceInitiate(
  inputs: CpaceInputs,
  options: CpaceTestOptions = {},
): { readonly share: Uint8Array; finish(peerShare: Uint8Array): Uint8Array } {
  const scalar = options.scalar ?? sampleScalar();
  const share = cpaceGenerator(inputs.prs, inputs.ci, inputs.sid).multiply(scalar).toBytes();
  return {
    share,
    finish: (peerShare) => cpaceIsk(inputs.sid, scalarMultVfy(scalar, peerShare), share, EMPTY, peerShare, EMPTY),
  };
}

/** The responder (B): checks the initiator's share, then returns its own share and the 64-byte ISK. */
export function cpaceRespond(
  inputs: CpaceInputs,
  peerShare: Uint8Array,
  options: CpaceTestOptions = {},
): { readonly share: Uint8Array; readonly isk: Uint8Array } {
  assertCpaceShare(peerShare);
  const scalar = options.scalar ?? sampleScalar();
  const share = cpaceGenerator(inputs.prs, inputs.ci, inputs.sid).multiply(scalar).toBytes();
  const k = scalarMultVfy(scalar, peerShare);
  return { share, isk: cpaceIsk(inputs.sid, k, peerShare, EMPTY, share, EMPTY) };
}
