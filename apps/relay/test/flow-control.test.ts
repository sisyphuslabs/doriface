import {
  CHALLENGE_BYTES,
  CloseCode,
  connectRelayClient,
  MAX_SESSION_SEND_BYTES,
  MAX_UNACKED_BYTES,
  MUX_HEADER_BYTES,
  type MuxFrame,
  MuxType,
  RELAY_MESSAGE_CAP,
  type SessionLink,
  type WebSocketLink,
} from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closedWith, received } from "./support/links.ts";
import { Probe, socketFrom, testIp } from "./support/probe.ts";
import { startRawHost } from "./support/raw-host.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";
import { inOrder, times } from "./support/sequential.ts";
import { startTestHost, type TestHost } from "./support/test-host.ts";

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startLocalRelay();
}, 120_000);

afterAll(() => relay.stop());

const clientUrl = (hostId: string): string => `${relay.url.replace("http", "ws")}/v1/client/${hostId}`;

/** A client session where the client has sent one frame, as every real Noise initiator does first. */
async function openSession(host: TestHost, ip: string): Promise<{ client: WebSocketLink; session: SessionLink }> {
  const client = await connectRelayClient({
    relayUrl: relay.url,
    hostId: host.uplink.hostId,
    createSocket: socketFrom(ip),
  });
  const session = await host.sessions.take();
  const first = received(session);
  client.send(new Uint8Array([1]));
  await first.take();
  return { client, session };
}

async function untilClose(next: () => Promise<MuxFrame>, seen: MuxFrame[] = []): Promise<MuxFrame[]> {
  const frame = await next();
  return frame.type === MuxType.Close ? [...seen, frame] : untilClose(next, [...seen, frame]);
}

describe("pending admission (C1)", () => {
  test("a full pending queue evicts the oldest pending session of the source holding the most", async () => {
    const host = await startTestHost(relay.url, testIp());
    const [ipA, ipB, ipC] = [testIp(), testIp(), testIp()];
    const fromA = await inOrder(times(3), () => openSession(host, ipA));
    const fromB = await inOrder(times(5), () => openSession(host, ipB));
    const [oldestB] = fromB;
    if (oldestB === undefined) throw new Error("no sessions from B");
    const clientEvicted = closedWith(oldestB.client);
    const sessionEvicted = closedWith(oldestB.session);

    const newcomer = await openSession(host, ipC);
    expect(await clientEvicted).toBe(CloseCode.RateLimited);
    expect(await sessionEvicted).toBe(CloseCode.RateLimited);
    const kept = [...fromA, ...fromB.slice(1), newcomer];
    expect(kept.map(({ client }) => client.closeCode)).toEqual(kept.map(() => undefined));
    host.uplink.stop();
  });
});

describe("backpressure (C3)", () => {
  test("a client that never acks is closed with 4408 once more than 4 MiB is unacked", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const probe = new Probe(clientUrl(host.uplink.hostId), ip);
    await probe.opened();
    const session = await host.sessions.take();
    const first = received(session);
    probe.socket.send(new Uint8Array([1]));
    await first.take();
    const sessionClosed = closedWith(session);
    await Promise.all(times(5).map((index) => session.send(new Uint8Array(MAX_SESSION_SEND_BYTES).fill(index))));
    expect((await probe.closed).code).toBe(CloseCode.IdleTimeout);
    expect(await sessionClosed).toBe(CloseCode.IdleTimeout);
    host.uplink.stop();
  });

  test("a client that acks keeps receiving far past 4 MiB", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const { client, session } = await openSession(host, ip);
    const atClient = received(client);
    const sizes = await inOrder(times(10), async (index) => {
      await session.send(new Uint8Array(MAX_SESSION_SEND_BYTES).fill(index));
      return (await atClient.take()).byteLength;
    });
    expect(sizes).toEqual(times(10).map(() => MAX_SESSION_SEND_BYTES));
    expect(client.closeCode).toBeUndefined();
    client.close();
    host.uplink.stop();
  });

  test("an uplink that never acks makes the relay close the client that overflows it with 4408", async () => {
    const ip = testIp();
    const host = await startRawHost(relay.url, ip);
    const client = await connectRelayClient({ relayUrl: relay.url, hostId: host.hostId, createSocket: socketFrom(ip) });
    expect((await host.frame()).type).toBe(MuxType.Open);
    const clientClosed = closedWith(client);
    for (const index of times(5)) client.send(new Uint8Array(MAX_SESSION_SEND_BYTES).fill(index));
    expect(await clientClosed).toBe(CloseCode.IdleTimeout);
    const frames = await untilClose(() => host.frame());
    // The relay counts its own challenge and OPEN against the uplink's window too.
    const forwarded = Math.floor((MAX_UNACKED_BYTES - CHALLENGE_BYTES - MUX_HEADER_BYTES) / RELAY_MESSAGE_CAP);
    expect(frames.map((frame) => frame.type)).toEqual([...times(forwarded).map(() => MuxType.Data), MuxType.Close]);
    expect(frames.at(-1)).toMatchObject({ type: MuxType.Close, code: CloseCode.IdleTimeout });
    host.probe.socket.close();
  });

  test("an ack for bytes the relay never sent closes the socket with 1003", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const probe = new Probe(clientUrl(host.uplink.hostId), ip);
    await probe.opened();
    probe.socket.send("a:65536");
    expect((await probe.closed).code).toBe(CloseCode.UnsupportedData);
    host.uplink.stop();
  });
});
