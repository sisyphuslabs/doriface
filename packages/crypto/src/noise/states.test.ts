import { describe, expect, test } from "bun:test";
import { generateHostIdentity, generateX25519 } from "../identity.ts";
import { rawStaticKey } from "../static-key.ts";
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
        staticKey: rawStaticKey(generateX25519()),
        remoteStatic: host.noise.publicKey,
        psk: new Uint8Array(length),
      });
    expect(build).toThrow("a psk is 32 bytes");
  });

  test("a handshake whose message 2 failed can never be finished, and a good one finishes once", async () => {
    const host = generateHostIdentity();
    const pair = () => {
      const prologue = new Uint8Array(0);
      const initiator = new Handshake({
        pattern: "IK",
        role: "initiator",
        prologue,
        staticKey: rawStaticKey(generateX25519()),
        remoteStatic: host.noise.publicKey,
      });
      const responder = new Handshake({
        pattern: "IK",
        role: "responder",
        prologue,
        staticKey: rawStaticKey(host.noise),
      });
      return { initiator, responder };
    };
    const bad = pair();
    await bad.responder.readMessage(await bad.initiator.writeMessage(new Uint8Array(0)));
    const reply = await bad.responder.writeMessage(new Uint8Array(0));
    reply[reply.length - 1] = (reply.at(-1) ?? 0) ^ 1;
    await expect(bad.initiator.readMessage(reply)).rejects.toThrow();
    expect(() => bad.initiator.finish()).toThrow("not complete");

    const good = pair();
    await good.responder.readMessage(await good.initiator.writeMessage(new Uint8Array(0)));
    await good.initiator.readMessage(await good.responder.writeMessage(new Uint8Array(0)));
    good.initiator.finish();
    expect(() => good.initiator.finish()).toThrow("not complete");
  });
});
