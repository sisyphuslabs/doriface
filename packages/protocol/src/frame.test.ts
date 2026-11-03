import { describe, expect, test } from "bun:test";
import {
  encodeCredit,
  encodeFrame,
  encodeResize,
  FrameDecoder,
  FrameError,
  FrameKind,
  HEADER_BYTES,
  MAX_PAYLOAD_BYTES,
  readCredit,
  readResize,
} from "./frame.ts";

const text = (s: string) => new TextEncoder().encode(s);
const nth = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`missing item ${index} of ${items.length}`);
  return item;
};

describe("frame codec", () => {
  test("header is channel u32 LE, kind u8, len u32 LE", () => {
    const bytes = encodeFrame(0x01020304, FrameKind.Data, text("hi"));
    expect([...bytes]).toEqual([4, 3, 2, 1, 0, 2, 0, 0, 0, 104, 105]);
  });

  test("decodes every frame regardless of chunk boundaries", () => {
    const stream = new Uint8Array([
      ...encodeFrame(0, FrameKind.Data, text('{"jsonrpc":"2.0"}')),
      ...encodeCredit(7, 262_144),
      ...encodeResize(7, 120, 40),
      ...encodeFrame(9, 250, text("unknown kind passes through")),
    ]);
    for (let split = 1; split < stream.byteLength; split++) {
      const decoder = new FrameDecoder();
      const frames = [...decoder.push(stream.subarray(0, split)), ...decoder.push(stream.subarray(split))];
      expect(frames.map((f) => [f.channel, f.kind])).toEqual([
        [0, FrameKind.Data],
        [7, FrameKind.Credit],
        [7, FrameKind.Resize],
        [9, 250],
      ]);
      expect(readCredit(nth(frames, 1).payload)).toBe(262_144);
      expect(readResize(nth(frames, 2).payload)).toEqual({ cols: 120, rows: 40 });
      expect(new TextDecoder().decode(nth(frames, 3).payload)).toBe("unknown kind passes through");
      expect(decoder.bufferedBytes).toBe(0);
    }
  });

  test("whole frames inside one chunk are zero-copy views", () => {
    const chunk = encodeFrame(3, FrameKind.Data, text("abc"));
    const frame = nth(new FrameDecoder().push(chunk), 0);
    expect(frame.payload.buffer).toBe(chunk.buffer);
    expect(frame.payload.byteOffset).toBe(HEADER_BYTES);
  });

  test("rejects oversized frames on both sides", () => {
    const header = new Uint8Array(HEADER_BYTES);
    new DataView(header.buffer).setUint32(5, MAX_PAYLOAD_BYTES + 1, true);
    expect(() => new FrameDecoder().push(header)).toThrow(FrameError);
    expect(() => encodeFrame(1, FrameKind.Data, new Uint8Array(MAX_PAYLOAD_BYTES + 1))).toThrow(FrameError);
  });
});
