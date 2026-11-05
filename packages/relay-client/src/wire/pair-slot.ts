import { MUX_HEADER_BYTES, MuxType, muxHeader } from "./mux.ts";
import { PAIR_SLOT_LENGTH, PAIR_SLOT_PATTERN } from "./pair-code.ts";

/**
 * PAIR_SLOT (type 4, host -> relay): `slot (3 ASCII) || noiseStaticPub (32)`, or the signed form (contract v1.8)
 * `slot || noiseStaticPub || expiresAt (u64 BE, ms) || signature (64)`, or empty to clear the host's slot; the relay
 * knows signPub from the challenge and stores the signature without checking it. PAIR_SLOT_ACK (type 5, relay -> host):
 * `status u8 || slot (3 ASCII)`.
 */
export const NOISE_STATIC_PUB_BYTES = 32;
export const PAIR_SLOT_EXPIRES_BYTES = 8;
export const PAIR_SLOT_SIGNATURE_BYTES = 64;
/** The domain of the host's signature over a slot (#22): apart from `doriface-relay-v1` and `doriface-mesh/1`. */
export const PAIR_SLOT_STATEMENT_PREFIX = "doriface-pair-slot-v1";
const UNSIGNED_BYTES = PAIR_SLOT_LENGTH + NOISE_STATIC_PUB_BYTES;
const SIGNED_BYTES = UNSIGNED_BYTES + PAIR_SLOT_EXPIRES_BYTES + PAIR_SLOT_SIGNATURE_BYTES;

/** The host's signature over its slot: the offer's expiry and an Ed25519 signature of `pairSlotStatement`. */
export interface PairSlotSignature {
  readonly expiresAt: number;
  readonly signature: Uint8Array;
}

/** An expiry the wire and JSON both carry exactly: a whole number of ms from 0 to Number.MAX_SAFE_INTEGER. */
export const isPairSlotExpiry = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const PairSlotAckStatus = { Registered: 0, Taken: 1, Malformed: 2 } as const;
export type PairSlotAckStatus = (typeof PairSlotAckStatus)[keyof typeof PairSlotAckStatus];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function checkedSlot(slot: string): Uint8Array {
  if (!PAIR_SLOT_PATTERN.test(slot)) throw new RangeError(`${JSON.stringify(slot)} is not a pairing slot`);
  return encoder.encode(slot);
}

/** The pairing slot spelled by the first 3 bytes of `bytes`, if they spell one. */
export function slotOf(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength < PAIR_SLOT_LENGTH) return undefined;
  const slot = decoder.decode(bytes.subarray(0, PAIR_SLOT_LENGTH));
  return PAIR_SLOT_PATTERN.test(slot) ? slot : undefined;
}

/** What the host signs (#22): `"doriface-pair-slot-v1" || slot (3) || noiseStaticPub (32) || expiresAt (u64 BE)`. */
export function pairSlotStatement(
  slot: string,
  noiseStaticPub: Uint8Array,
  expiresAt: number,
): Uint8Array<ArrayBuffer> {
  if (noiseStaticPub.byteLength !== NOISE_STATIC_PUB_BYTES) throw new RangeError("noiseStaticPub must be 32 bytes");
  if (!isPairSlotExpiry(expiresAt)) throw new RangeError("expiresAt must be a safe integer of ms, at least 0");
  const prefix = encoder.encode(PAIR_SLOT_STATEMENT_PREFIX);
  const out = new Uint8Array(prefix.byteLength + UNSIGNED_BYTES + PAIR_SLOT_EXPIRES_BYTES);
  out.set(prefix, 0);
  out.set(checkedSlot(slot), prefix.byteLength);
  out.set(noiseStaticPub, prefix.byteLength + PAIR_SLOT_LENGTH);
  new DataView(out.buffer).setBigUint64(prefix.byteLength + UNSIGNED_BYTES, BigInt(expiresAt));
  return out;
}

/** The unsigned form, or with `signed` the signed form of contract v1.8. */
export function encodePairSlotRequest(
  slot: string,
  noiseStaticPub: Uint8Array,
  signed?: PairSlotSignature,
): Uint8Array<ArrayBuffer> {
  if (noiseStaticPub.byteLength !== NOISE_STATIC_PUB_BYTES) throw new RangeError("noiseStaticPub must be 32 bytes");
  if (signed !== undefined && signed.signature.byteLength !== PAIR_SLOT_SIGNATURE_BYTES)
    throw new RangeError("a slot signature must be 64 bytes");
  if (signed !== undefined && !isPairSlotExpiry(signed.expiresAt))
    throw new RangeError("expiresAt must be a safe integer of ms, at least 0");
  const out = muxHeader(MuxType.PairSlot, 0, signed === undefined ? UNSIGNED_BYTES : SIGNED_BYTES);
  out.set(checkedSlot(slot), MUX_HEADER_BYTES);
  out.set(noiseStaticPub, MUX_HEADER_BYTES + PAIR_SLOT_LENGTH);
  if (signed !== undefined) {
    new DataView(out.buffer).setBigUint64(MUX_HEADER_BYTES + UNSIGNED_BYTES, BigInt(signed.expiresAt));
    out.set(signed.signature, MUX_HEADER_BYTES + UNSIGNED_BYTES + PAIR_SLOT_EXPIRES_BYTES);
  }
  return out;
}

export function encodePairSlotClear(): Uint8Array<ArrayBuffer> {
  return muxHeader(MuxType.PairSlot, 0, 0);
}

/** Either form; undefined for any other length, a bad slot, or an expiry above Number.MAX_SAFE_INTEGER. */
export function decodePairSlotRequest(
  payload: Uint8Array,
): { readonly slot: string; readonly noiseStaticPub: Uint8Array; readonly signed?: PairSlotSignature } | undefined {
  const slot = slotOf(payload);
  if (slot === undefined) return undefined;
  if (payload.byteLength === UNSIGNED_BYTES) return { slot, noiseStaticPub: payload.slice(PAIR_SLOT_LENGTH) };
  if (payload.byteLength !== SIGNED_BYTES) return undefined;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const expiry = view.getBigUint64(UNSIGNED_BYTES);
  if (expiry > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return {
    slot,
    noiseStaticPub: payload.slice(PAIR_SLOT_LENGTH, UNSIGNED_BYTES),
    signed: { expiresAt: Number(expiry), signature: payload.slice(UNSIGNED_BYTES + PAIR_SLOT_EXPIRES_BYTES) },
  };
}

export function encodePairSlotAck(slot: string, status: PairSlotAckStatus): Uint8Array<ArrayBuffer> {
  const out = muxHeader(MuxType.PairSlotAck, 0, 1 + PAIR_SLOT_LENGTH);
  out[MUX_HEADER_BYTES] = status;
  out.set(checkedSlot(slot), MUX_HEADER_BYTES + 1);
  return out;
}

export function decodePairSlotAck(
  payload: Uint8Array,
): { readonly slot: string; readonly status: PairSlotAckStatus } | undefined {
  if (payload.byteLength !== 1 + PAIR_SLOT_LENGTH) return undefined;
  const slot = slotOf(payload.subarray(1));
  const status = payload[0];
  const known =
    status === PairSlotAckStatus.Registered ||
    status === PairSlotAckStatus.Taken ||
    status === PairSlotAckStatus.Malformed
      ? status
      : undefined;
  return slot === undefined || known === undefined ? undefined : { slot, status: known };
}
