import { MUX_HEADER_BYTES, MuxType, muxHeader } from "./mux.ts";
import { PAIR_SLOT_LENGTH, PAIR_SLOT_PATTERN } from "./pair-code.ts";

/**
 * PAIR_SLOT (type 4, host -> relay): `slot (3 ASCII) || noiseStaticPub (32)`, or empty to clear the host's slot; the
 * relay knows signPub from the challenge. PAIR_SLOT_ACK (type 5, relay -> host): `status u8 || slot (3 ASCII)`.
 */
export const NOISE_STATIC_PUB_BYTES = 32;
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

export function encodePairSlotRequest(slot: string, noiseStaticPub: Uint8Array): Uint8Array<ArrayBuffer> {
  if (noiseStaticPub.byteLength !== NOISE_STATIC_PUB_BYTES) throw new RangeError("noiseStaticPub must be 32 bytes");
  const out = muxHeader(MuxType.PairSlot, 0, PAIR_SLOT_LENGTH + NOISE_STATIC_PUB_BYTES);
  out.set(checkedSlot(slot), MUX_HEADER_BYTES);
  out.set(noiseStaticPub, MUX_HEADER_BYTES + PAIR_SLOT_LENGTH);
  return out;
}

export function encodePairSlotClear(): Uint8Array<ArrayBuffer> {
  return muxHeader(MuxType.PairSlot, 0, 0);
}

export function decodePairSlotRequest(
  payload: Uint8Array,
): { readonly slot: string; readonly noiseStaticPub: Uint8Array } | undefined {
  const slot = slotOf(payload);
  if (slot === undefined || payload.byteLength !== PAIR_SLOT_LENGTH + NOISE_STATIC_PUB_BYTES) return undefined;
  return { slot, noiseStaticPub: payload.slice(PAIR_SLOT_LENGTH) };
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
