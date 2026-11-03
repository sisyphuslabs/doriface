import { describe, expect, test } from "bun:test";
import type { ByteLink } from "../link.ts";
import { nextClose } from "./memory-link.ts";

describe("nextClose", () => {
  test("resolves for a link that reports an earlier close synchronously, and unsubscribes", async () => {
    const reason = new Error("gone");
    let unsubscribed = false;
    const closedLink: ByteLink = {
      send() {},
      onData: () => () => {},
      onClose(listener) {
        listener(reason);
        return () => {
          unsubscribed = true;
        };
      },
      close() {},
    };
    expect(await nextClose(closedLink)).toBe(reason);
    expect(unsubscribed).toBe(true);
  });
});
