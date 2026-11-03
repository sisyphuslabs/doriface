import { describe, expect, test } from "bun:test";
import { LinkClosedError } from "./link.ts";
import { SessionLink } from "./session-link.ts";
import { decodeMux, MAX_UNACKED_BYTES, MuxType, SESSION_WINDOW_BYTES } from "./wire/index.ts";

const MiB = 1024 * 1024;

function closeCodes(frames: readonly Uint8Array[]): number[] {
  return frames
    .filter((frame) => frame[0] === 3)
    .map((frame) => new DataView(frame.buffer, frame.byteOffset).getUint16(5, true));
}

function recordingLink(): { readonly link: SessionLink; readonly frames: Uint8Array[] } {
  const frames: Uint8Array[] = [];
  return {
    link: new SessionLink(5, undefined, { sendFrame: (frame) => frames.push(frame) > 0, release: () => {} }),
    frames,
  };
}

const typesOf = (frames: readonly Uint8Array[]): number[] => frames.map((frame) => decodeMux(frame).type);

describe("SessionLink", () => {
  test("a write the uplink can no longer carry rejects instead of vanishing", async () => {
    const link = new SessionLink(1, undefined, { sendFrame: () => false, release: () => {} });
    await expect(link.send(new Uint8Array([1]))).rejects.toBeInstanceOf(LinkClosedError);
  });

  test.each([
    [4401, 4401],
    [4429, 4429],
    [1011, 1011],
    [undefined, 1000],
  ])("close(%p) tells the relay %p in the CLOSE frame", (code, sent) => {
    const frames: Uint8Array[] = [];
    const link = new SessionLink(7, "Q7M", {
      sendFrame: (frame) => frames.push(frame) > 0,
      release: () => {},
    });
    link.close(code, "refused");
    const [frame] = frames;
    expect(frame?.[0]).toBe(3);
    expect(frame === undefined ? -1 : new DataView(frame.buffer, frame.byteOffset).getUint16(5, true)).toBe(sent);
  });

  test("a write the uplink carried resolves with the DATA frame sent", async () => {
    const frames: Uint8Array[] = [];
    const link = new SessionLink(1, undefined, {
      sendFrame: (frame) => frames.push(frame) > 0,
      release: () => {},
    });
    await link.send(new Uint8Array([9]));
    expect(frames).toEqual([new Uint8Array([2, 1, 0, 0, 0, 9])]);
  });

  test("a session whose reader keeps up stays open well past 4 MiB of total traffic", async () => {
    const { link, frames } = recordingLink();
    let taken = 0;
    let next = Promise.withResolvers<void>();
    link.onData((bytes) => {
      taken += bytes.byteLength;
      next.resolve();
    });
    const feed = async (left: number): Promise<void> => {
      if (left === 0) return;
      next = Promise.withResolvers<void>();
      link.deliver(new Uint8Array(MiB));
      if (closeCodes(frames).length > 0) return;
      await next.promise;
      return feed(left - 1);
    };
    await feed(12);
    expect(taken).toBe(12 * MiB);
    expect(closeCodes(frames)).toEqual([]);
  });

  test("exactly 4 MiB waiting for the reader is allowed; one byte more closes only this session with 4408", () => {
    const { link, frames } = recordingLink();
    link.deliver(new Uint8Array(MAX_UNACKED_BYTES));
    expect(closeCodes(frames)).toEqual([]);
    link.deliver(new Uint8Array(1));
    expect(closeCodes(frames)).toEqual([4408]);
  });

  test("after the relay's zero CREDIT, sends past the window wait and go in order as CREDIT returns", async () => {
    const { link, frames } = recordingLink();
    const half = new Uint8Array(SESSION_WINDOW_BYTES / 2 + 1);
    expect(link.credited(0)).toBe(true);
    const sends = [link.send(half), link.send(half), link.send(half)];
    await sends[0];
    expect(frames).toHaveLength(1);
    expect(link.credited(half.byteLength)).toBe(true);
    await sends[1];
    expect(frames).toHaveLength(2);
    expect(link.credited(2 * half.byteLength)).toBe(false);
    link.close();
    expect(await sends[2]?.catch((error: unknown) => error)).toBeInstanceOf(LinkClosedError);
  });

  test("once credit flows, the bytes its consumer took are credited back every 64 KiB", async () => {
    const { link, frames } = recordingLink();
    link.credited(0);
    const taken: number[] = [];
    const allTaken = Promise.withResolvers<void>();
    link.onData((bytes) => {
      if (taken.push(bytes.byteLength) === 3) allTaken.resolve();
    });
    for (const size of [40_000, 40_000, 40_000]) link.deliver(new Uint8Array(size));
    await allTaken.promise;
    expect(taken).toEqual([40_000, 40_000, 40_000]);
    const credits = frames.map((frame) => decodeMux(frame)).filter((frame) => frame.type === MuxType.Credit);
    expect(credits).toEqual([{ type: MuxType.Credit, sessionId: 5, bytes: 80_000 }]);
    expect(typesOf(frames)).toEqual([MuxType.Credit]);
  });
});
