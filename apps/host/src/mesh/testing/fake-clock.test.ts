import { describe, expect, test } from "bun:test";
import { FakeClock, settle } from "./fake-clock.ts";

// #323: settle() returns at a quiet point, not after a fixed number of event-loop turns, so a test costs turns in
// proportion to its work and a chain that crosses many macrotasks (WebCrypto, as Noise does) still finishes inside it.
describe("settle() waits for a quiet point (#323)", () => {
  test("a chain of 40 WebCrypto steps, each resolving on a later macrotask, finishes inside one settle()", async () => {
    let steps = 0;
    const chain = async (left: number): Promise<void> => {
      if (left === 0) return;
      await crypto.subtle.digest("SHA-256", new Uint8Array([left]));
      steps += 1;
      return chain(left - 1);
    };
    void chain(40);
    await settle();
    expect(steps).toBe(40);
  });

  test("a timer whose run starts a WebCrypto chain is done when advance() returns", async () => {
    const clock = new FakeClock();
    let derived = false;
    clock.after(1_000, () => {
      void crypto.subtle
        .digest("SHA-256", new Uint8Array([1]))
        .then((first) => crypto.subtle.digest("SHA-256", first))
        .then((second) => {
          derived = true;
          return second;
        });
    });
    await clock.advance(1_000);
    expect(derived).toBe(true);
  });

  test("with nothing pending, settle() returns within a few event-loop turns", async () => {
    const original = globalThis.setImmediate;
    let turns = 0;
    globalThis.setImmediate = ((run: () => void) => {
      turns += 1;
      return original(run);
    }) as typeof setImmediate;
    try {
      await settle();
    } finally {
      globalThis.setImmediate = original;
    }
    expect(turns).toBeLessThanOrEqual(3);
  });
});
