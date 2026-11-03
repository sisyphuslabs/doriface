import { encodeFrame, FrameKind, RPC_CHANNEL } from "@doriface/protocol";
import type { ByteReader } from "../../../apps/host/src/testing/byte-reader.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ParsedFrame {
  readonly channel: number;
  readonly kind: number;
  readonly payload: Uint8Array;
}

export function rpc(id: number, method: string, params: Readonly<Record<string, unknown>>): Uint8Array {
  return encodeFrame(
    RPC_CHANNEL,
    FrameKind.Data,
    encoder.encode(JSON.stringify({ jsonrpc: "2.0", id, method, params })),
  );
}

export function input(channel: number, text: string): Uint8Array {
  return encodeFrame(channel, FrameKind.Data, encoder.encode(text));
}

export function parseFrame(bytes: Uint8Array): ParsedFrame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { channel: view.getUint32(0, true), kind: view.getUint8(4), payload: bytes.subarray(9) };
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, name)?.value : undefined;
}

/** Reads frames until the JSON-RPC reply with `id`, feeding every terminal frame to `onTerminal`. */
export async function replyTo(
  reader: ByteReader,
  id: number,
  onTerminal: (frame: ParsedFrame) => void,
): Promise<unknown> {
  const frame = parseFrame(await reader.frame());
  if (frame.channel !== RPC_CHANNEL) {
    onTerminal(frame);
    return replyTo(reader, id, onTerminal);
  }
  const message: unknown = JSON.parse(decoder.decode(frame.payload));
  if (field(message, "id") !== id) return replyTo(reader, id, onTerminal);
  const error = field(message, "error");
  if (error !== undefined) throw new Error(`hc call ${id} failed: ${JSON.stringify(error)}`);
  return field(message, "result");
}

/** Reads frames, feeding terminal frames to `onTerminal`, until `done()` holds. */
export async function drainUntil(
  reader: ByteReader,
  done: () => boolean,
  onTerminal: (frame: ParsedFrame) => void,
): Promise<void> {
  if (done()) return;
  const frame = parseFrame(await reader.frame());
  if (frame.channel !== RPC_CHANNEL) onTerminal(frame);
  return drainUntil(reader, done, onTerminal);
}

export { field };
