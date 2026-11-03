import {
  CloseCode,
  CROCKFORD_ALPHABET,
  ed25519Signer,
  generateSigningKey,
  Uplink,
  encodePairSlotRequest,
  lookupPairSlot,
  PairLookupError,
} from "@doriface/relay-client";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { defer, runDeferred } from "./support/cleanup.ts";
import { Probe, socketFrom, testIp } from "./support/probe.ts";
import { AsyncQueue } from "./support/queue.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";
import { inOrder, times } from "./support/sequential.ts";
import { startTestHost } from "./support/test-host.ts";

let relay: LocalRelay;

beforeAll(async () => {
  relay = await startLocalRelay();
}, 120_000);

afterAll(() => relay.stop());

afterEach(runDeferred);

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

  test("registering a new slot releases the host's previous one", async () => {
    const host = await startTestHost(relay.url, testIp());
    const [first, second] = [randomSlot(), randomSlot()];
    await host.uplink.registerPairSlot(first, crypto.getRandomValues(new Uint8Array(32)));
    await host.uplink.registerPairSlot(second, crypto.getRandomValues(new Uint8Array(32)));
    expect(await lookup(typed(first))).toBeUndefined();
    expect((await lookup(typed(second)))?.hostId).toBe(host.uplink.hostId);
    host.uplink.stop();
  });

  test("after the uplink reconnects, the host can still clear its slot and moving it releases the old one", async () => {
    const ip = testIp();
    const sockets: WebSocket[] = [];
    const answered = new AsyncQueue<void>();
    const uplink = await Uplink.start({
      relayUrl: relay.url,
      signer: ed25519Signer(generateSigningKey()),
      onSession: () => {},
      onState: (state) => {
        if (state.state === "answered") answered.push();
      },
      createSocket: (url) => {
        const ws = socketFrom(ip)(url);
        sockets.push(ws);
        return ws;
      },
    });
    defer(() => uplink.stop());
    await answered.take();
    const [moved, kept] = [randomSlot(), randomSlot()];
    await uplink.registerPairSlot(moved, crypto.getRandomValues(new Uint8Array(32)));
    sockets.at(-1)?.close();
    await answered.take();
    await uplink.registerPairSlot(kept, crypto.getRandomValues(new Uint8Array(32)));
    expect(await lookup(typed(moved))).toBeUndefined();
    sockets.at(-1)?.close();
    await answered.take();
    await uplink.clearPairSlot();
    expect(await lookup(typed(kept))).toBeUndefined();
  });

  test("a host whose uplink was replaced can clear the slot the old uplink registered", async () => {
    const ip = testIp();
    const first = await startTestHost(relay.url, ip);
    const slot = randomSlot();
    await first.uplink.registerPairSlot(slot, crypto.getRandomValues(new Uint8Array(32)));
    const second = await startTestHost(relay.url, ip, { secretKey: first.secretKey });
    expect(await first.uplink.stopped).toBe(CloseCode.UplinkReplaced);
    await second.uplink.clearPairSlot(slot);
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

  test("lookups over the per-IP rate are refused with 429", async () => {
    const ip = testIp();
    const results = await inOrder(times(21), () => lookup(typed(randomSlot()), ip).catch((error: unknown) => error));
    expect(results.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => undefined));
    const refused = results[20];
    expect(refused instanceof PairLookupError ? refused.status : refused).toBe(429);
  });
});
