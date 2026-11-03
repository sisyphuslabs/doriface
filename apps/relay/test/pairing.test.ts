import {
  CloseCode,
  connectRelayClient,
  CROCKFORD_ALPHABET,
  encodePairSlotRequest,
  lookupPairSlot,
  PairLookupError,
} from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closedWith, received } from "./support/links.ts";
import { Probe, socketFrom, testIp } from "./support/probe.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";
import { inOrder, times } from "./support/sequential.ts";
import { startTestHost } from "./support/test-host.ts";

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startLocalRelay();
}, 120_000);

afterAll(() => relay.stop());

function randomSlot(): string {
  return [...crypto.getRandomValues(new Uint8Array(3))].map((byte) => CROCKFORD_ALPHABET[byte % 32]).join("");
}

/** A typed code for `slot` as a person might enter it: lower case, with the display space. */
const typed = (slot: string): string => `${slot}0 abcd`.toLowerCase();

const lookup = (code: string, ip = testIp()) =>
  lookupPairSlot({
    relayUrl: relay.url,
    code,
    fetch: (url) => fetch(url, { headers: { "cf-connecting-ip": ip } }),
  });

describe("pairing slots", () => {
  test("a registered slot answers with the host's id and keys", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const slot = randomSlot();
    const noiseStaticPub = crypto.getRandomValues(new Uint8Array(32));
    expect(await host.uplink.registerPairSlot(slot, noiseStaticPub)).toBe("registered");
    expect(await lookup(typed(slot))).toEqual({
      hostId: host.uplink.hostId,
      noiseStaticPub,
      signPub: host.signer.publicKey,
    });
    host.uplink.stop();
  });

  test("a slot another host holds is taken; the holder may refresh it", async () => {
    const ip = testIp();
    const holder = await startTestHost(relay.url, ip);
    const other = await startTestHost(relay.url, ip);
    const slot = randomSlot();
    const key = crypto.getRandomValues(new Uint8Array(32));
    expect(await holder.uplink.registerPairSlot(slot, key)).toBe("registered");
    expect(await other.uplink.registerPairSlot(slot, crypto.getRandomValues(new Uint8Array(32)))).toBe("taken");
    const refreshed = crypto.getRandomValues(new Uint8Array(32));
    expect(await holder.uplink.registerPairSlot(slot, refreshed)).toBe("registered");
    expect((await lookup(typed(slot)))?.noiseStaticPub).toEqual(refreshed);
    holder.uplink.stop();
    other.uplink.stop();
  });

  test("an unknown slot is not found", async () => {
    expect(await lookup(typed(randomSlot()))).toBeUndefined();
  });

  test("an unauthenticated uplink cannot register a slot", async () => {
    const slot = randomSlot();
    const probe = new Probe(`${relay.url.replace("http", "ws")}/v1/host/${"c".repeat(25)}a`, testIp());
    await probe.next();
    probe.socket.send(encodePairSlotRequest(slot, crypto.getRandomValues(new Uint8Array(32))));
    expect((await probe.closed).code).toBe(CloseCode.RelayAuthFailed);
    expect(await lookup(typed(slot))).toBeUndefined();
  });

  test("a cleared slot is not found any more", async () => {
    const host = await startTestHost(relay.url, testIp());
    const slot = randomSlot();
    expect(await host.uplink.registerPairSlot(slot, crypto.getRandomValues(new Uint8Array(32)))).toBe("registered");
    await host.uplink.clearPairSlot();
    expect(await lookup(typed(slot))).toBeUndefined();
    host.uplink.stop();
  });

  test("a slot answers 10 lookups per 10 minutes from any source, then 429", async () => {
    const host = await startTestHost(relay.url, testIp());
    const slot = randomSlot();
    await host.uplink.registerPairSlot(slot, crypto.getRandomValues(new Uint8Array(32)));
    const answers = await inOrder(times(11), () =>
      lookup(typed(slot)).then(
        (record) => record?.hostId,
        (error: unknown) => (error instanceof PairLookupError ? error.status : error),
      ),
    );
    expect(answers).toEqual([...times(10).map(() => host.uplink.hostId), 429]);
    host.uplink.stop();
  });

  test("a slot admits 10 pairing sessions per 10 minutes, then 4429; other sessions are unaffected", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const slot = randomSlot();
    await host.uplink.registerPairSlot(slot, crypto.getRandomValues(new Uint8Array(32)));
    const pairing = () =>
      connectRelayClient({
        relayUrl: relay.url,
        hostId: host.uplink.hostId,
        pairSlot: slot,
        createSocket: socketFrom(ip),
      });
    await inOrder(times(10), async () => {
      const client = await pairing();
      const session = await host.sessions.take();
      const atHost = received(session);
      client.send(new Uint8Array([1]));
      await atHost.take();
      const ended = closedWith(session);
      client.close();
      await ended;
    });
    expect(await closedWith(await pairing())).toBe(CloseCode.RateLimited);
    const regular = await connectRelayClient({
      relayUrl: relay.url,
      hostId: host.uplink.hostId,
      createSocket: socketFrom(ip),
    });
    expect((await host.sessions.take()).sessionId).toBeGreaterThanOrEqual(0);
    expect(regular.closeCode).toBeUndefined();
    regular.close();
    host.uplink.stop();
  });

  test("a pairing session to a host that does not hold the slot is closed with 4404", async () => {
    const ip = testIp();
    const host = await startTestHost(relay.url, ip);
    const client = await connectRelayClient({
      relayUrl: relay.url,
      hostId: host.uplink.hostId,
      pairSlot: randomSlot(),
      createSocket: socketFrom(ip),
    });
    expect(await closedWith(client)).toBe(CloseCode.HostOffline);
    host.uplink.stop();
  });

  test("lookups over the per-IP rate are refused with 429", async () => {
    const ip = testIp();
    const results = await inOrder(times(21), () => lookup(typed(randomSlot()), ip).catch((error: unknown) => error));
    expect(results.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => undefined));
    const refused = results[20];
    expect(refused instanceof PairLookupError ? refused.status : refused).toBe(429);
  });
});
