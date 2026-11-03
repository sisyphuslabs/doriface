/**
 * Relay <-> host multiplexing frame: `[type u8][sessionId u32 LE][payload]`.
 * OPEN has no payload, DATA carries opaque bytes, CLOSE carries a u16 LE close code.
 */

export const MuxType = { Open: 1, Data: 2, Close: 3 } as const;
export type MuxType = (typeof MuxType)[keyof typeof MuxType];

export const MUX_HEADER_BYTES = 5;

export type MuxFrame =
  | { readonly type: typeof MuxType.Open; readonly sessionId: number }
  | { readonly type: typeof MuxType.Data; readonly sessionId: number; readonly payload: Uint8Array }
  | { readonly type: typeof MuxType.Close; readonly sessionId: number; readonly code: number };

export class MuxError extends Error {
  override readonly name = "MuxError";
}

export function muxHeader(type: MuxType, sessionId: number, payloadBytes: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sessionId) || sessionId < 0 || sessionId > 0xffff_ffff) {
    throw new MuxError(`sessionId ${sessionId} is not a u32`);
  }
  const out = new Uint8Array(MUX_HEADER_BYTES + payloadBytes);
  const view = new DataView(out.buffer);
  view.setUint8(0, type);
  view.setUint32(1, sessionId, true);
  return out;
}

export function encodeOpen(sessionId: number): Uint8Array<ArrayBuffer> {
  return muxHeader(MuxType.Open, sessionId, 0);
}

export function encodeData(sessionId: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = muxHeader(MuxType.Data, sessionId, payload.byteLength);
  out.set(payload, MUX_HEADER_BYTES);
  return out;
}

export function encodeClose(sessionId: number, code: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(code) || code < 0 || code > 0xffff) throw new MuxError(`close code ${code} is not a u16`);
  const out = muxHeader(MuxType.Close, sessionId, 2);
  new DataView(out.buffer).setUint16(MUX_HEADER_BYTES, code, true);
  return out;
}

/** Decodes one frame. DATA payloads are zero-copy views of `bytes`. */
export function decodeMux(bytes: Uint8Array): MuxFrame {
  if (bytes.byteLength < MUX_HEADER_BYTES) throw new MuxError(`frame of ${bytes.byteLength} bytes has no header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0);
  const sessionId = view.getUint32(1, true);
  const rest = bytes.byteLength - MUX_HEADER_BYTES;
  switch (type) {
    case MuxType.Open:
      if (rest !== 0) throw new MuxError(`OPEN carries ${rest} payload bytes`);
      return { type, sessionId };
    case MuxType.Data:
      return { type, sessionId, payload: bytes.subarray(MUX_HEADER_BYTES) };
    case MuxType.Close:
      if (rest !== 2) throw new MuxError(`CLOSE payload must be 2 bytes, got ${rest}`);
      return { type, sessionId, code: view.getUint16(MUX_HEADER_BYTES, true) };
    default:
      throw new MuxError(`unknown frame type ${type}`);
  }
}
