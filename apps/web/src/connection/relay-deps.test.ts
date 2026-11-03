import { afterAll, expect, test } from "bun:test";
import { pairWithHost } from "../pair/handshake.ts";
import { connect } from "./connect.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

let closed = Promise.withResolvers<number>();
const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade", { status: 426 })),
  websocket: { message() {}, close: (_ws, code) => closed.resolve(code) },
});
afterAll(() => relay.stop(true));

const relayUrl = `http://127.0.0.1:${relay.port}`;
const HOST_ID = "a".repeat(26);
const keyFailure = new Error("IndexedDB is unavailable");
const deps = { loadDeviceKey: () => Promise.reject(keyFailure) };

test("pairing closes the open relay socket when the device key cannot load", async () => {
  closed = Promise.withResolvers<number>();
  const offer = {
    hostId: HOST_ID,
    noiseStaticPub: new Uint8Array(32),
    signPub: new Uint8Array(32),
    secret: { mode: "code", code: "ABCDEFGH" },
    relayUrl,
    fingerprint: "",
  } as const;
  await expect(pairWithHost(offer, "phone", deps)).rejects.toBe(keyFailure);
  expect(await closed.promise).toBe(1000);
});

test("connecting closes the open relay socket when the device key cannot load", async () => {
  closed = Promise.withResolvers<number>();
  const settings = { ...DEFAULT_SETTINGS, relayUrl, hostId: HOST_ID, hostKey: "A".repeat(43) };
  await expect(connect(settings, undefined, deps)).rejects.toBe(keyFailure);
  expect(await closed.promise).toBe(1000);
});
