import {
  authMessage,
  CloseCode,
  connectRelayClient,
  ed25519Signer,
  encodeAuthAnswer,
  generateSigningKey,
  hostIdOf,
  RelayCloseError,
  Uplink,
} from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Closed, Probe, socketFrom, testIp } from "./support/probe.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";
import { startTestHost } from "./support/test-host.ts";

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startLocalRelay();
}, 120_000);

afterAll(() => relay.stop());

const hostUrl = (hostId: string): string => `${relay.url.replace("http", "ws")}/v1/host/${hostId}`;

async function answerWith(hostId: string, answer: (challenge: Uint8Array) => Promise<Uint8Array>): Promise<Closed> {
  const probe = new Probe(hostUrl(hostId), testIp());
  const challenge = await probe.next();
  expect(challenge.byteLength).toBe(32);
  probe.socket.send(await answer(challenge));
  return probe.closed;
}

describe("host challenge auth", () => {
  test("healthz reports the relay version", async () => {
    expect(await (await fetch(`${relay.url}/healthz`)).json()).toEqual({ ok: true, version: "0.0.0" });
  });

  test("a correctly signed answer brings the host online for clients", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const client = await connectRelayClient({
      relayUrl: relay.url,
      hostId: host.uplink.hostId,
      createSocket: socketFrom(ip),
    });
    const session = await host.sessions.take();
    expect(session.sessionId).toBeGreaterThanOrEqual(0);
    expect(client.closeCode).toBeUndefined();
    client.close();
    host.uplink.stop();
    expect(await host.uplink.stopped).toBe(CloseCode.Normal);
  });

  test("a bad signature is closed with 4403", async () => {
    const signer = ed25519Signer(generateSigningKey());
    const hostId = await hostIdOf(signer.publicKey);
    const closed = await answerWith(hostId, async () =>
      encodeAuthAnswer(signer.publicKey, crypto.getRandomValues(new Uint8Array(64))),
    );
    expect(closed.code).toBe(CloseCode.RelayAuthFailed);
  });

  test("a key that does not hash to the hostId is closed with 4403", async () => {
    const signer = ed25519Signer(generateSigningKey());
    const otherId = await hostIdOf(ed25519Signer(generateSigningKey()).publicKey);
    const closed = await answerWith(otherId, async (challenge) =>
      encodeAuthAnswer(signer.publicKey, await signer.sign(authMessage(otherId, challenge))),
    );
    expect(closed.code).toBe(CloseCode.RelayAuthFailed);
  });

  test("an uplink stops for good on 4403", async () => {
    const signer = ed25519Signer(generateSigningKey());
    const wrong = ed25519Signer(generateSigningKey());
    const uplink = await Uplink.start({
      relayUrl: relay.url,
      signer: { publicKey: signer.publicKey, sign: (message) => wrong.sign(message) },
      createSocket: socketFrom(testIp()),
      onSession: () => {},
    });
    expect(await uplink.stopped).toBe(CloseCode.RelayAuthFailed);
  });

  test("a newer uplink for the same host replaces the old one and ends its sessions", async () => {
    const ip = testIp();
    const first = await startTestHost(relay.url, ip);
    const hostId = first.uplink.hostId;
    const oldClient = await connectRelayClient({ relayUrl: relay.url, hostId, createSocket: socketFrom(ip) });
    const oldSession = await first.sessions.take();
    // A client that has sent a frame, as every real one has; see workerd#7566 in sessions.test.ts.
    const hello = new Promise<Uint8Array>((resolve) => oldSession.onData(resolve));
    oldClient.send(new Uint8Array([1]));
    await hello;
    const oldSessionClosed = new Promise<Error | undefined>((resolve) => oldSession.onClose(resolve));
    const oldClientClosed = new Promise<Error | undefined>((resolve) => oldClient.onClose(resolve));

    const second = await startTestHost(relay.url, ip, first.secretKey);
    expect(await first.uplink.stopped).toBe(CloseCode.UplinkReplaced);
    expect(await oldSessionClosed).toBeInstanceOf(RelayCloseError);
    const clientError = await oldClientClosed;
    expect(clientError instanceof RelayCloseError ? clientError.code : undefined).toBe(CloseCode.HostOffline);

    const newClient = await connectRelayClient({ relayUrl: relay.url, hostId, createSocket: socketFrom(ip) });
    const newSession = await second.sessions.take();
    const payload = crypto.getRandomValues(new Uint8Array(64));
    const received = new Promise<Uint8Array>((resolve) => newSession.onData(resolve));
    newClient.send(payload);
    expect(await received).toEqual(payload);
    expect(first.sessions.size).toBe(0);
    newClient.close();
    second.uplink.stop();
  });
});
