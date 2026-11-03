import { MUX_HEADER_BYTES, MuxType, muxHeader } from "./mux.ts";
import { PAIR_SLOT_LENGTH, PAIR_SLOT_PATTERN } from "./pair-code.ts";

/**
 * PAIR_SLOT payloads. Host -> relay: `slot (3 ASCII) || noiseStaticPub (32)`; the relay knows signPub from the
 * challenge and needs noiseStaticPub for `GET /v1/pair/<slot>`. Relay -> host: `slot (3 ASCII) || status u16 LE`.
 */
export const NOISE_STATIC_PUB_BYTES = 32;
export const PairSlotStatus = { Registered: 200, Taken: 409 } as const;
export type PairSlotStatus = (typeof PairSlotStatus)[keyof typeof PairSlotStatus];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function slotFrame(slot: string, rest: number): Uint8Array<ArrayBuffer> {
  if (!PAIR_SLOT_PATTERN.test(slot)) throw new RangeError(`${JSON.stringify(slot)} is not a pairing slot`);
  const out = muxHeader(MuxType.PairSlot, 0, PAIR_SLOT_LENGTH + rest);
  out.set(encoder.encode(slot), MUX_HEADER_BYTES);
  return out;
}

function slotOf(payload: Uint8Array): string | undefined {
  const slot = decoder.decode(payload.subarray(0, PAIR_SLOT_LENGTH));
  return PAIR_SLOT_PATTERN.test(slot) ? slot : undefined;
}

export function encodePairSlotRequest(slot: string, noiseStaticPub: Uint8Array): Uint8Array<ArrayBuffer> {
  if (noiseStaticPub.byteLength !== NOISE_STATIC_PUB_BYTES) throw new RangeError("noiseStaticPub must be 32 bytes");
  const out = slotFrame(slot, NOISE_STATIC_PUB_BYTES);
  out.set(noiseStaticPub, MUX_HEADER_BYTES + PAIR_SLOT_LENGTH);
  return out;
}

export function decodePairSlotRequest(
  payload: Uint8Array,
): { readonly slot: string; readonly noiseStaticPub: Uint8Array } | undefined {
  const slot = slotOf(payload);
  if (slot === undefined || payload.byteLength !== PAIR_SLOT_LENGTH + NOISE_STATIC_PUB_BYTES) return undefined;
  return { slot, noiseStaticPub: payload.slice(PAIR_SLOT_LENGTH) };
}

export function encodePairSlotReply(slot: string, status: PairSlotStatus): Uint8Array<ArrayBuffer> {
  const out = slotFrame(slot, 2);
  new DataView(out.buffer).setUint16(MUX_HEADER_BYTES + PAIR_SLOT_LENGTH, status, true);
  return out;
}

export function decodePairSlotReply(
  payload: Uint8Array,
): { readonly slot: string; readonly status: PairSlotStatus } | undefined {
  const slot = slotOf(payload);
  if (slot === undefined || payload.byteLength !== PAIR_SLOT_LENGTH + 2) return undefined;
  const code = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(PAIR_SLOT_LENGTH, true);
  const status = code === PairSlotStatus.Registered || code === PairSlotStatus.Taken ? code : undefined;
  return status === undefined ? undefined : { slot, status };
}
