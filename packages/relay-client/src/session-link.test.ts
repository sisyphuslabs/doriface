import { describe, expect, test } from "bun:test";
import { LinkClosedError } from "./link.ts";
import { SessionLink } from "./session-link.ts";

describe("SessionLink", () => {
  test("a write the uplink can no longer carry rejects instead of vanishing", async () => {
    const link = new SessionLink(1, undefined, { sendFrame: () => false, release: () => {}, consumed: () => {} });
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
      consumed: () => {},
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
      consumed: () => {},
    });
    await link.send(new Uint8Array([9]));
    expect(frames).toEqual([new Uint8Array([2, 1, 0, 0, 0, 9])]);
  });
});
