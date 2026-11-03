import {
  CloseCode,
  connectRelayClient,
  MAX_SESSION_SEND_BYTES,
  RELAY_MESSAGE_CAP,
  RelayCloseError,
  type SessionLink,
  type WebSocketLink,
} from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Probe, socketFrom, testIp } from "./support/probe.ts";
import { AsyncQueue } from "./support/queue.ts";
import { inOrder, times } from "./support/sequential.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";
import { startTestHost } from "./support/test-host.ts";

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startLocalRelay();
}, 120_000);

afterAll(() => relay.stop());

const clientUrl = (hostId: string): string => `${relay.url.replace("http", "ws")}/v1/client/${hostId}`;

function received(link: SessionLink | WebSocketLink): AsyncQueue<Uint8Array> {
  const queue = new AsyncQueue<Uint8Array>();
  link.onData((bytes) => queue.push(bytes));
  link.onClose((error) => queue.end(error ?? new Error("link closed")));
  return queue;
}

function closeCodeOf(error: Error | undefined): number | undefined {
  return error instanceof RelayCloseError ? error.code : error === undefined ? CloseCode.Normal : undefined;
}

const closedWith = (link: SessionLink | WebSocketLink): Promise<number | undefined> =>
  new Promise((resolve) => link.onClose((error) => resolve(closeCodeOf(error))));

describe("client sessions through the relay", () => {
  test("a client to an offline host is closed with 4404", async () => {
    const probe = new Probe(clientUrl("a".repeat(26)), testIp());
    expect((await probe.closed).code).toBe(CloseCode.HostOffline);
  });

  test("random bytes round-trip byte-exact in both directions", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const client = await connectRelayClient({
      relayUrl: relay.url,
      hostId: host.uplink.hostId,
      createSocket: socketFrom(ip),
    });
    const session = await host.sessions.take();
    const atHost = received(session);
    const atClient = received(client);
    const sizes = [1, 7, 1024, 65_535, 65_536, 300_000, MAX_SESSION_SEND_BYTES];
    await inOrder(sizes, async (size) => {
      const up = crypto.getRandomValues(new Uint8Array(size));
      const down = crypto.getRandomValues(new Uint8Array(size));
      client.send(up);
      await session.send(down);
      expect(await atHost.take()).toEqual(up);
      expect(await atClient.take()).toEqual(down);
    });
    const capped = crypto.getRandomValues(new Uint8Array(RELAY_MESSAGE_CAP));
    client.send(capped);
    expect(await atHost.take()).toEqual(capped);
    const burst = Array.from({ length: 200 }, (_, i) => crypto.getRandomValues(new Uint8Array(1 + i)));
    for (const bytes of burst) client.send(bytes);
    expect(await inOrder(burst, () => atHost.take())).toEqual(burst);

    const sessionClosed = closedWith(session);
    client.close();
    expect(await sessionClosed).toBe(CloseCode.Normal);
    host.uplink.stop();
  });

  test("a host closing a session closes the client socket", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const client = await connectRelayClient({
      relayUrl: relay.url,
      hostId: host.uplink.hostId,
      createSocket: socketFrom(ip),
    });
    const session = await host.sessions.take();
    // Like a real initiator's Noise msg1. workerd delays the TCP close of a hibernatable socket that has not sent a
    // data frame by ~10 s (cloudflare/workerd#7566), which only shows locally.
    const first = received(session);
    client.send(new Uint8Array([1]));
    await first.take();
    const clientClosed = closedWith(client);
    session.close();
    expect(await clientClosed).toBe(CloseCode.Normal);
    host.uplink.stop();
  });

  test("the 33rd concurrent client is refused with 4429 and a freed slot is reusable", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const connect = (): Promise<WebSocketLink> =>
      connectRelayClient({ relayUrl: relay.url, hostId: host.uplink.hostId, createSocket: socketFrom(ip) });
    const clients = await Promise.all(Array.from({ length: 32 }, connect));
    const sessions = await Promise.all(clients.map(() => host.sessions.take()));
    expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(32);
    expect(clients.every((client) => client.closeCode === undefined)).toBe(true);

    const refused = await connect();
    expect(await closedWith(refused)).toBe(CloseCode.RateLimited);

    const [first] = sessions;
    if (first === undefined) throw new Error("no sessions");
    const released = closedWith(first);
    clients[0]?.close();
    await released;
    const again = await connect();
    await host.sessions.take();
    expect(again.closeCode).toBeUndefined();
    host.uplink.stop();
  });

  test("a message over 1 MiB is rejected with 1009", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const probe = new Probe(clientUrl(host.uplink.hostId), ip);
    await probe.opened();
    const session = await host.sessions.take();
    const sessionClosed = closedWith(session);
    probe.socket.send(new Uint8Array(RELAY_MESSAGE_CAP + 1));
    expect((await probe.closed).code).toBe(CloseCode.MessageTooBig);
    expect(await sessionClosed).toBe(CloseCode.MessageTooBig);
    host.uplink.stop();
  });

  test("connections over the per-IP rate are refused with 4429", async () => {
    const ip = testIp();
    const codes = await inOrder(times(61), async () => (await new Probe(clientUrl("b".repeat(26)), ip).closed).code);
    expect(codes.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => CloseCode.HostOffline));
    expect(codes[60]).toBe(CloseCode.RateLimited);
    expect((await new Probe(clientUrl("b".repeat(26)), testIp()).closed).code).toBe(CloseCode.HostOffline);
  });
});
