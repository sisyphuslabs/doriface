/**
 * herdr-core framed wire format.
 *
 * After a `hello` with `framed: true`, every message on the connection is a frame:
 *
 *   [channel u32 LE][kind u8][len u32 LE][payload: len bytes]
 *
 * Channel 0 carries JSON-RPC both ways; other channels carry terminal streams.
 * The codec keeps `kind` as a plain number so unknown kinds pass through untouched:
 * doriface never re-encodes a frame it does not need to understand.
 */

export const HEADER_BYTES = 9;
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const RPC_CHANNEL = 0;

export const FrameKind = {
  Data: 0,
  Credit: 1,
  Close: 2,
  Resize: 3,
  Focus: 4,
  Facts: 5,
  /** Bytes the viewer's terminal generated itself (query answers), never human typing. */
  AutomaticInput: 6,
} as const;
export type KnownFrameKind = (typeof FrameKind)[keyof typeof FrameKind];

export interface Frame {
  readonly channel: number;
  readonly kind: number;
  readonly payload: Uint8Array;
}

export class FrameError extends Error {
  override readonly name = "FrameError";
}

const EMPTY = new Uint8Array(0);

export function encodeFrame(channel: number, kind: number, payload: Uint8Array = EMPTY): Uint8Array {
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new FrameError(`payload of ${payload.byteLength} bytes exceeds ${MAX_PAYLOAD_BYTES}`);
  }
  const out = new Uint8Array(HEADER_BYTES + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, channel, true);
  view.setUint8(4, kind);
  view.setUint32(5, payload.byteLength, true);
  out.set(payload, HEADER_BYTES);
  return out;
}

export function encodeCredit(channel: number, bytes: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, bytes, true);
  return encodeFrame(channel, FrameKind.Credit, payload);
}

export function encodeResize(channel: number, cols: number, rows: number): Uint8Array {
  const payload = new Uint8Array(4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, cols, true);
  view.setUint16(2, rows, true);
  return encodeFrame(channel, FrameKind.Resize, payload);
}

/**
 * Incremental decoder for a byte stream of frames. Chunk boundaries may fall anywhere,
 * including inside a header. Payloads that arrive whole inside one chunk are returned
 * as zero-copy views of that chunk.
 *
 * The bytes of an unfinished frame are held as the chunks they came in and joined once,
 * when the frame is whole: a frame of n bytes arriving in k chunks costs O(n), not the
 * O(n * k) of joining on every chunk (#481: an 8 MiB reply in 64 KiB records).
 */
export class FrameDecoder {
  #held: Uint8Array[] = [];
  #heldBytes = 0;
  /** The held bytes needed before the next frame can be read: its header, then its whole frame. */
  #needed = HEADER_BYTES;

  push(chunk: Uint8Array): Frame[] {
    let buf = chunk;
    if (this.#heldBytes > 0) {
      // A copy, as before: the caller may reuse its buffer once push returns.
      this.#held.push(chunk.slice());
      this.#heldBytes += chunk.byteLength;
      if (this.#heldBytes < this.#needed) return [];
      buf = new Uint8Array(this.#heldBytes);
      let at = 0;
      for (const part of this.#held) {
        buf.set(part, at);
        at += part.byteLength;
      }
    }
    const frames: Frame[] = [];
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;
    while (buf.byteLength - offset >= HEADER_BYTES) {
      const len = view.getUint32(offset + 5, true);
      if (len > MAX_PAYLOAD_BYTES) {
        throw new FrameError(`frame length ${len} exceeds ${MAX_PAYLOAD_BYTES}`);
      }
      const end = offset + HEADER_BYTES + len;
      if (end > buf.byteLength) {
        this.#needed = HEADER_BYTES + len;
        break;
      }
      frames.push({
        channel: view.getUint32(offset, true),
        kind: view.getUint8(offset + 4),
        payload: buf.subarray(offset + HEADER_BYTES, end),
      });
      offset = end;
    }
    const rest = buf.byteLength - offset;
    if (rest < HEADER_BYTES) this.#needed = HEADER_BYTES;
    this.#held = rest === 0 ? [] : [buf.slice(offset)];
    this.#heldBytes = rest;
    return frames;
  }

  get bufferedBytes(): number {
    return this.#heldBytes;
  }
}

export function readCredit(payload: Uint8Array): number {
  if (payload.byteLength !== 4) throw new FrameError(`credit payload must be 4 bytes, got ${payload.byteLength}`);
  return new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, true);
}

export function readResize(payload: Uint8Array): { cols: number; rows: number } {
  if (payload.byteLength !== 4) throw new FrameError(`resize payload must be 4 bytes, got ${payload.byteLength}`);
  const view = new DataView(payload.buffer, payload.byteOffset, 4);
  return { cols: view.getUint16(0, true), rows: view.getUint16(2, true) };
}
