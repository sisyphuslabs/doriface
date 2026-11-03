import { describe, expect, test } from "bun:test";
import { generateHostIdentity, generateX25519 } from "../identity.ts";
import { CipherState } from "./cipher-state.ts";
import { Handshake } from "./handshake.ts";

describe("Noise state guards", () => {
  test.each([0, -1, 1.5, Number.NaN])("a rekey interval of %p is rejected", (interval) => {
    expect(() => new CipherState(new Uint8Array(32), interval)).toThrow(RangeError);
  });

  test.each([16, 31, 33])("a %p-byte psk is rejected when the handshake is built", (length) => {
    const host = generateHostIdentity();
    const build = () =>
      new Handshake({
        pattern: "IKpsk2",
        role: "initiator",
        prologue: new Uint8Array(0),
        staticKey: generateX25519(),
        remoteStatic: host.noise.publicKey,
        psk: new Uint8Array(length),
      });
    expect(build).toThrow("a psk is 32 bytes");
  });
});
