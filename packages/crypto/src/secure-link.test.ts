import { describe, expect, test } from "bun:test";
import { concatBytes } from "./encoding.ts";
import { generateHostIdentity, generateX25519, type KeyPair } from "./identity.ts";
import { CloseCode, SecureLinkError } from "./link.ts";
import { createPairingOffer, decodePairingHello, encodePairingHello, pairingPsk } from "./pairing.ts";
import { type Authorization, type ClientHello, secureLink } from "./secure-link.ts";
import type { SecureLink } from "./secured-link.ts";
import { memoryLinkPair, type MemoryEnd, nextClose } from "./testing/memory-link.ts";
import { MAX_PLAINTEXT } from "./transport.ts";

const host = generateHostIdentity();
const device = generateX25519();
const psk = pairingPsk(createPairingOffer().code);
const hellos: ClientHello[] = [];

interface Setup {
  readonly clientPsk?: Uint8Array;
  readonly authorize?: (hello: ClientHello) => Authorization;
  readonly clientKey?: KeyPair;
  readonly rekey?: readonly [number, number];
  readonly name?: string;
  /** Rewrites the client's first message (message 1) in flight. */
  readonly tamperHello?: (bytes: Uint8Array) => Uint8Array;
}

function connect(setup: Setup = {}) {
  const [clientEnd, hostEnd] = memoryLinkPair();
  const tamperHello = setup.tamperHello;
  if (tamperHello !== undefined) tamperNext(clientEnd, (bytes) => [tamperHello(bytes)]);
  const responder = secureLink(hostEnd, {
    role: "responder",
    hostId: host.hostId,
    staticKey: host.noise,
    rekeyInterval: setup.rekey?.[1],
    authorize:
      setup.authorize ??
      ((hello) => {
        hellos.push(hello);
        return { accept: true, psk };
      }),
  });
  const initiator = secureLink(clientEnd, {
    role: "initiator",
    hostId: host.hostId,
    staticKey: setup.clientKey ?? device,
    remoteStatic: host.noise.publicKey,
    psk: setup.clientPsk,
    payload: setup.name === undefined ? undefined : encodePairingHello(setup.name),
    rekeyInterval: setup.rekey?.[0],
  });
  return { clientEnd, hostEnd, initiator, responder };
}

const collect = (link: SecureLink): Uint8Array[] => {
  const chunks: Uint8Array[] = [];
  link.onData((chunk) => chunks.push(chunk));
  return chunks;
};

async function settledError(promise: Promise<unknown>): Promise<SecureLinkError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof SecureLinkError)) throw new Error(`expected a SecureLinkError, got ${String(error)}`);
  return error;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function established(setup: Setup = {}) {
  const pair = connect(setup);
  const [client, server] = await Promise.all([pair.initiator, pair.responder]);
  return { ...pair, client, server };
}

describe("secureLink", () => {
  test("pairs over IKpsk2, then reconnects over IK, carrying bytes both ways", async () => {
    const paired = await established({ clientPsk: psk, name: "laptop" });
    expect([paired.client.pattern, paired.server.pattern]).toEqual(["IKpsk2", "IKpsk2"]);
    expect(decodePairingHello(paired.server.helloPayload)).toBe("laptop");
    expect(paired.server.remoteStatic).toEqual(device.publicKey);
    expect(paired.client.handshakeHash).toEqual(paired.server.handshakeHash);

    const again = await established();
    expect([again.client.pattern, again.server.pattern]).toEqual(["IK", "IK"]);
    expect(hellos.at(-1)?.pattern).toBe("IK");
    const atServer = collect(again.server);
    const atClient = collect(again.client);
    again.client.send(new TextEncoder().encode("ping"));
    again.server.send(new TextEncoder().encode("pong"));
    await flush();
    expect(atServer.map((c) => new TextDecoder().decode(c))).toEqual(["ping"]);
    expect(atClient.map((c) => new TextDecoder().decode(c))).toEqual(["pong"]);
  });

  test("chunks a 1 MiB write into records of at most 65535 bytes, reassembled in order", async () => {
    const { client, server, clientEnd } = await established();
    const atServer = collect(server);
    const big = crypto.getRandomValues(new Uint8Array(1024 * 1024));
    const before = clientEnd.sent.length;
    client.send(big);
    await flush();
    const records = clientEnd.sent.slice(before);
    expect(records).toHaveLength(Math.ceil(big.byteLength / MAX_PLAINTEXT));
    expect(Math.max(...records.map((r) => r.byteLength))).toBe(65_535);
    expect(atServer.every((chunk) => chunk.byteLength <= MAX_PLAINTEXT)).toBe(true);
    expect(concatBytes(...atServer)).toEqual(big);
  });

  test("data that arrives before the first onData listener is held for it", async () => {
    const { client, server } = await established();
    client.send(Uint8Array.of(1, 2, 3));
    await flush();
    expect(collect(server)).toEqual([Uint8Array.of(1, 2, 3)]);
  });

  test("rekeys every interval: matching sides keep talking, a side that skips the rekey fails with 4400", async () => {
    const good = await established({ rekey: [3, 3] });
    const atServer = collect(good.server);
    for (let i = 0; i < 10; i++) good.client.send(Uint8Array.of(i));
    await flush();
    expect(atServer).toEqual(Array.from({ length: 10 }, (_, i) => Uint8Array.of(i)));

    const skew = await established({ rekey: [3, 1_000] });
    const closed = nextClose(skew.server);
    for (let i = 0; i < 4; i++) skew.client.send(Uint8Array.of(i));
    expect(await closed).toMatchObject({ code: CloseCode.CryptoFailure });
  });
});

/** Rewrites the next message the end sends. */
function tamperNext(end: MemoryEnd, rewrite: (bytes: Uint8Array) => readonly Uint8Array[]): void {
  end.tap = (bytes) => {
    end.tap = undefined;
    return rewrite(bytes);
  };
}

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

  test("a silent peer times out with 4408", async () => {
    const [, hostEnd] = memoryLinkPair();
    const responder = secureLink(hostEnd, {
      role: "responder",
      hostId: host.hostId,
      staticKey: host.noise,
      timeoutMs: 20,
      authorize: () => ({ accept: true }),
    });
    expect((await settledError(responder)).code).toBe(CloseCode.IdleTimeout);
    expect(hostEnd.closeCode).toBe(CloseCode.IdleTimeout);
  });
});
