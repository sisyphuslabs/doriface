import { describe, expect, test } from "bun:test";
import { encodeFrame, FrameDecoder, FrameKind } from "./frame.ts";
import { LineDecoder, LineTooLongError } from "./lines.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("LineDecoder", () => {
  test("returns the same lines for every chunk split, multi-byte characters included", () => {
    const stream = bytes('{"seq":1}\n{"title":"héllo ✓"}\n\npartial');
    for (let split = 0; split <= stream.byteLength; split++) {
      const decoder = new LineDecoder();
      const lines = [...decoder.push(stream.subarray(0, split)), ...decoder.push(stream.subarray(split))];
      expect(lines).toEqual(['{"seq":1}', '{"title":"héllo ✓"}', ""]);
      expect(decoder.bufferedBytes).toBe("partial".length);
    }
  });

  test("stops after maxLines and hands the rest back as frames", () => {
    const frame = encodeFrame(0, FrameKind.Data, bytes('{"id":1}'));
    const stream = new Uint8Array([...bytes('{"id":0}\n'), ...frame]);
    const decoder = new LineDecoder();
    expect(decoder.push(stream, 1)).toEqual(['{"id":0}']);
    const frames = new FrameDecoder().push(decoder.takeBuffered());
    expect(frames.map((f) => new TextDecoder().decode(f.payload))).toEqual(['{"id":1}']);
    expect(decoder.bufferedBytes).toBe(0);
  });

  test("refuses an unterminated line past the limit", () => {
    const decoder = new LineDecoder(8);
    expect(decoder.push(bytes("12345678"))).toEqual([]);
    expect(() => decoder.push(bytes("9"))).toThrow(LineTooLongError);
  });
});
