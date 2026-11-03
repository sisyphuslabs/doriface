import { describe, expect, test } from "bun:test";
import { LinkClosedError } from "./link.ts";
import { SessionLink } from "./session-link.ts";

describe("SessionLink", () => {
  test("a write the uplink can no longer carry rejects instead of vanishing", async () => {
    const link = new SessionLink(1, { sendFrame: () => false, release: () => {}, consumed: () => {} });
    await expect(link.send(new Uint8Array([1]))).rejects.toBeInstanceOf(LinkClosedError);
  });

  test("a write the uplink carried resolves with the DATA frame sent", async () => {
    const frames: Uint8Array[] = [];
    const link = new SessionLink(1, {
      sendFrame: (frame) => frames.push(frame) > 0,
      release: () => {},
      consumed: () => {},
    });
    await link.send(new Uint8Array([9]));
    expect(frames).toEqual([new Uint8Array([2, 1, 0, 0, 0, 9])]);
  });
});
