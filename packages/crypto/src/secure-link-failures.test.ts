import { describe, expect, test } from "bun:test";
import { generateX25519 } from "./identity.ts";
import { CloseCode, SecureLinkError } from "./link.ts";
import { Handshake } from "./noise/handshake.ts";
import { createPairingOffer, pairingPsk } from "./pairing.ts";
import { secureLink } from "./secure-link.ts";
import { rawStaticKey } from "./static-key.ts";
import { memoryLinkPair, nextClose } from "./testing/memory-link.ts";
import {
  collect,
  connect,
  device,
  established,
  flush,
  host,
  psk,
  settledError,
  tamperNext,
} from "./testing/secure-link-fixture.ts";

describe("secureLink failures", () => {
  test("a record with one flipped bit closes the link with 4400", async () => {
    const { client, server, clientEnd, hostEnd } = await established();
    const closed = nextClose(server);
    tamperNext(clientEnd, (bytes) => {
      const copy = bytes.slice();
      copy[5] = (copy[5] ?? 0) ^ 0x01;
      return [copy];
    });
    client.send(Uint8Array.of(9, 9, 9, 9, 9, 9));
    expect(await closed).toBeInstanceOf(SecureLinkError);
    expect(hostEnd.closeCode).toBe(CloseCode.CryptoFailure);
  });

  test("a tampered record over a synchronously closing link still reports 4400 to onClose", async () => {
    const { client, server, clientEnd } = await established({ synchronous: true });
    const reasons: (Error | undefined)[] = [];
    server.onClose((error) => reasons.push(error));
    tamperNext(clientEnd, (bytes) => [bytes.map((byte, i) => (i === 0 ? byte ^ 1 : byte))]);
    client.send(Uint8Array.of(1));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ code: CloseCode.CryptoFailure });
  });

  test("a replayed record closes the link with 4400", async () => {
    const { client, server, clientEnd, hostEnd } = await established();
    const atServer = collect(server);
    const closed = nextClose(server);
    client.send(Uint8Array.of(1));
    await flush();
    const old = clientEnd.sent.at(-1);
    if (old === undefined) throw new Error("nothing was sent");
    hostEnd.deliver(old);
    expect(await closed).toMatchObject({ code: CloseCode.CryptoFailure });
    expect(atServer).toEqual([Uint8Array.of(1)]);
    expect(hostEnd.closeCode).toBe(CloseCode.CryptoFailure);
  });

  test("a tampered message 1 closes with 4400 before authorize runs", async () => {
    let asked = false;
    const pair = connect({
      authorize: () => ((asked = true), { accept: true }),
      tamperHello: (bytes) => bytes.map((byte, i) => (i === 40 ? byte ^ 1 : byte)),
    });
    expect((await settledError(pair.responder)).code).toBe(CloseCode.CryptoFailure);
    expect((await settledError(pair.initiator)).code).toBe(CloseCode.CryptoFailure);
    expect(asked).toBe(false);
  });

  test("a wrong psk fails the pairing with 4400 on both sides", async () => {
    const pair = connect({ clientPsk: pairingPsk(createPairingOffer().code), name: "phone" });
    expect((await settledError(pair.initiator)).code).toBe(CloseCode.CryptoFailure);
    expect(pair.clientEnd.closeCode).toBe(CloseCode.CryptoFailure);
    expect((await settledError(pair.responder)).code).toBe(CloseCode.CryptoFailure);
  });

  test("an unknown client static key is refused with 4401", async () => {
    const stranger = generateX25519();
    const pair = connect({
      clientKey: stranger,
      authorize: (hello) => ({ accept: hello.remoteStatic.toHex() === device.publicKey.toHex() }),
    });
    expect((await settledError(pair.responder)).code).toBe(CloseCode.UnknownDevice);
    expect(pair.hostEnd.closeCode).toBe(CloseCode.UnknownDevice);
    expect((await settledError(pair.initiator)).code).toBe(CloseCode.UnknownDevice);
  });

  test("an IKpsk2 attempt with no pending pairing is refused with 4401", async () => {
    const pair = connect({ clientPsk: psk, name: "phone", authorize: () => ({ accept: true }) });
    expect((await settledError(pair.responder)).code).toBe(CloseCode.UnknownDevice);
    expect((await settledError(pair.initiator)).code).toBe(CloseCode.UnknownDevice);
  });

  test("a message 1 whose payload breaks the JSON-line rule closes with 4400", async () => {
    const [clientEnd, hostEnd] = memoryLinkPair();
    const responder = secureLink(hostEnd, {
      role: "responder",
      hostId: host.hostId,
      staticKey: rawStaticKey(host.noise),
      authorize: () => ({ accept: true }),
    });
    const handshake = new Handshake({
      pattern: "IK",
      role: "initiator",
      prologue: new TextEncoder().encode(`doriface/1${host.hostId}`),
      staticKey: rawStaticKey(device),
      remoteStatic: host.noise.publicKey,
    });
    clientEnd.send(await handshake.writeMessage(new TextEncoder().encode('{"v":2}\n')));
    expect((await settledError(responder)).code).toBe(CloseCode.CryptoFailure);
  });

  test("a silent peer times out with 4408", async () => {
    const [, hostEnd] = memoryLinkPair();
    const responder = secureLink(hostEnd, {
      role: "responder",
      hostId: host.hostId,
      staticKey: rawStaticKey(host.noise),
      timeoutMs: 20,
      authorize: () => ({ accept: true }),
    });
    expect((await settledError(responder)).code).toBe(CloseCode.IdleTimeout);
    expect(hostEnd.closeCode).toBe(CloseCode.IdleTimeout);
  });
});
