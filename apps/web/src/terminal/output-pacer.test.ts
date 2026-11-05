import { describe, expect, test } from "bun:test";
import { FRAME_BYTES, type FrameTimer, OutputPacer } from "./output-pacer.ts";

/** Animation frames that run only when the test says so. */
function manualFrames() {
  const frames: (() => void)[] = [];
  const frame: FrameTimer = (run) => {
    frames.push(run);
    return () => frames.splice(frames.indexOf(run), 1);
  };
  return { frame, frames, nextFrame: (): void => frames.shift()?.() };
}

const bytes = (length: number, fill = 0x61) => new Uint8Array(length).fill(fill);

describe("OutputPacer (#560)", () => {
  test("output that arrives within a frame is written once, on the frame, and credited only then", () => {
    const clock = manualFrames();
    const written: number[] = [];
    const credited: number[] = [];
    const pacer = new OutputPacer((batch) => written.push(batch.byteLength), clock.frame);
    for (const size of [10, 20, 30]) pacer.push(bytes(size), (count) => credited.push(count));
    expect(written).toEqual([]);
    expect(credited).toEqual([]);
    clock.nextFrame();
    expect(written).toEqual([60]);
    expect(credited).toEqual([10, 20, 30]);
  });

  test("a flood is written at most FRAME_BYTES a frame, in order, with credit for exactly what was written", () => {
    const clock = manualFrames();
    const written: Uint8Array[] = [];
    let credited = 0;
    const pacer = new OutputPacer((batch) => written.push(batch), clock.frame);
    pacer.push(bytes(FRAME_BYTES + 100, 0x61), (count) => (credited += count));
    pacer.push(bytes(50, 0x62), (count) => (credited += count));
    clock.nextFrame();
    expect(written.map((batch) => batch.byteLength)).toEqual([FRAME_BYTES]);
    expect(credited).toBe(FRAME_BYTES);
    clock.nextFrame();
    expect(written.map((batch) => batch.byteLength)).toEqual([FRAME_BYTES, 150]);
    expect(credited).toBe(FRAME_BYTES + 150);
    expect([...(written[1] ?? [])]).toEqual([...bytes(100, 0x61), ...bytes(50, 0x62)]);
    expect(clock.frames).toHaveLength(0);
  });

  test("out of view nothing is written or credited; once it shows, what waited is written from the next frame", () => {
    const clock = manualFrames();
    const written: number[] = [];
    let credited = 0;
    const pacer = new OutputPacer((batch) => written.push(batch.byteLength), clock.frame);
    pacer.setVisible(false);
    pacer.push(bytes(5), (count) => (credited += count));
    pacer.push(bytes(7), (count) => (credited += count));
    expect(clock.frames).toHaveLength(0);
    expect(written).toEqual([]);
    expect(credited).toBe(0);
    pacer.setVisible(true);
    clock.nextFrame();
    expect(written).toEqual([12]);
    expect(credited).toBe(12);
  });

  test("drop forgets queued output without crediting it", () => {
    const clock = manualFrames();
    const written: number[] = [];
    let credited = 0;
    const pacer = new OutputPacer((batch) => written.push(batch.byteLength), clock.frame);
    pacer.push(bytes(9), (count) => (credited += count));
    pacer.drop();
    expect(clock.frames).toHaveLength(0);
    pacer.push(bytes(4));
    clock.nextFrame();
    expect(written).toEqual([4]);
    expect(credited).toBe(0);
  });
});
