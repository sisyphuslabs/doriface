import type { SecureLink } from "@doriface/crypto";
import { describe, expect, test } from "bun:test";
import { plaintextLink, type Wire } from "./links.ts";

/** A decrypted session whose records the test emits by hand. */
function fakeSecure(): SecureLink & { readonly emit: (bytes: Uint8Array) => void } {
  let data: ((bytes: Uint8Array) => void) | undefined;
  return {
    pattern: "IK",
    remoteStatic: new Uint8Array(32),
    handshakeHash: new Uint8Array(32),
    peerName: undefined,
    lanUrls: [],
    send() {},
    onData(listener) {
      data = listener;
      return () => {};
    },
    onClose: () => () => {},
    close() {},
    emit: (bytes) => data?.(bytes),
  };
}

const OPEN_GATE = (): Promise<void> | undefined => undefined;

describe("plaintextLink", () => {
  test("holds the socket's reads while hc connect is behind, and releases them once it caught up", async () => {
    const secure = fakeSecure();
    let gate = OPEN_GATE;
    const wire: Wire = { flushed: () => Promise.resolve(), readWhen: (next) => (gate = next) };
    const link = plaintextLink(secure, wire);
    const first = Promise.withResolvers<void>();
    const delivered: number[] = [];
    link.onData((bytes) => {
      delivered.push(bytes[0] ?? -1);
      return bytes[0] === 1 ? first.promise : undefined;
    });
    secure.emit(Uint8Array.of(1));
    expect(gate()).toBeUndefined();
    secure.emit(Uint8Array.of(2));
    const held = gate();
    expect(held).toBeInstanceOf(Promise);
    first.resolve();
    await held;
    expect(delivered).toEqual([1, 2]);
    expect(gate()).toBeUndefined();
  });
});
