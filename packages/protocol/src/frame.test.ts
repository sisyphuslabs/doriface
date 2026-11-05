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

  test("decodes frames fed through one reused buffer, a few bytes at a time", () => {
    const big = new Uint8Array(70_000).map((_, i) => i % 251);
    const stream = new Uint8Array([
      ...encodeFrame(0, FrameKind.Data, text('{"jsonrpc":"2.0"}')),
      ...encodeFrame(5, FrameKind.Data, big),
      ...encodeCredit(7, 262_144),
    ]);
    for (const size of [1, 4, 9, 10, 4096]) {
      const decoder = new FrameDecoder();
      const reused = new Uint8Array(size);
      const frames = [];
      for (let at = 0; at < stream.byteLength; at += size) {
        const part = stream.subarray(at, at + size);
        reused.set(part);
        for (const f of decoder.push(reused.subarray(0, part.byteLength))) {
          frames.push({ channel: f.channel, kind: f.kind, payload: f.payload.slice() });
        }
        reused.fill(0xff);
      }
      expect(frames.map((f) => [f.channel, f.kind, f.payload.byteLength])).toEqual([
        [0, FrameKind.Data, 17],
        [5, FrameKind.Data, big.byteLength],
        [7, FrameKind.Credit, 4],
      ]);
      expect(nth(frames, 1).payload).toEqual(big);
      expect(readCredit(nth(frames, 2).payload)).toBe(262_144);
      expect(decoder.bufferedBytes).toBe(0);
    }
  });

  test("kind bytes match herdr-core wire.rs", () => {
    expect(Object.values(FrameKind)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const bytes = encodeFrame(2, FrameKind.AutomaticInput, text("\x1b[1;1R"));
    expect(bytes[4]).toBe(6);
    expect(nth(new FrameDecoder().push(bytes), 0).kind).toBe(FrameKind.AutomaticInput);
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
