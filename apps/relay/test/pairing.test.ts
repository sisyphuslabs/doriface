import {
  CloseCode,
  CROCKFORD_ALPHABET,
  encodePairSlotRequest,
  lookupPairSlot,
  PairLookupError,
} from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Probe, testIp } from "./support/probe.ts";
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
    const probe = new Probe(`${relay.url.replace("http", "ws")}/v1/host/${"c".repeat(26)}`, testIp());
    await probe.next();
    probe.socket.send(encodePairSlotRequest(slot, crypto.getRandomValues(new Uint8Array(32))));
    expect((await probe.closed).code).toBe(CloseCode.RelayAuthFailed);
    expect(await lookup(typed(slot))).toBeUndefined();
  });

  test("lookups over the per-IP rate are refused with 429", async () => {
    const ip = testIp();
    const results = await inOrder(times(21), () => lookup(typed(randomSlot()), ip).catch((error: unknown) => error));
    expect(results.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => undefined));
    const refused = results[20];
    expect(refused instanceof PairLookupError ? refused.status : refused).toBe(429);
  });
});
