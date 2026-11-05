import { afterAll, describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ed25519Signer, generateSigningKey } from "./signer.ts";
import { Uplink } from "./uplink.ts";
import {
  decodeMux,
  decodePairSlotRequest,
  encodePairSlotAck,
  MUX_HEADER_BYTES,
  MuxType,
  PairSlotAckStatus,
  pairSlotStatement,
} from "./wire/index.ts";

/** What the relay under test does with a signed PAIR_SLOT: a v1.9 relay registers it, an older one acks Malformed. */
let relayIsV18 = true;
const seen: { readonly slot: string; readonly signed: boolean; readonly ok: boolean }[] = [];
let signPub: Uint8Array = new Uint8Array(0);
const answered: PromiseWithResolvers<void>[] = [];

const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade", { status: 426 })),
  websocket: {
    open: (ws) => {
      ws.send(new Uint8Array(32));
    },
    message: (ws, message) => {
      if (typeof message === "string") return;
      if (message.byteLength === 96) {
        answered.shift()?.resolve();
        return;
      }
      const frame = decodeMux(message);
      if (frame.type !== MuxType.PairSlot) return;
      const request = decodePairSlotRequest(message.subarray(MUX_HEADER_BYTES));
      if (request === undefined) return;
      const { signed } = request;
      const ok =
        signed !== undefined &&
        ed25519.verify(
          signed.signature,
          pairSlotStatement(request.slot, request.noiseStaticPub, signed.expiresAt),
          signPub,
        );
      seen.push({ slot: request.slot, signed: signed !== undefined, ok });
      const status = signed !== undefined && !relayIsV18 ? PairSlotAckStatus.Malformed : PairSlotAckStatus.Registered;
      ws.send(encodePairSlotAck(request.slot, status));
    },
  },
});
afterAll(() => relay.stop(true));

async function start(unsigned: string[]): Promise<Uplink> {
  const key = generateSigningKey();
  const signer = ed25519Signer(key);
  signPub = signer.publicKey;
  const ready = Promise.withResolvers<void>();
  answered.push(ready);
  const uplink = await Uplink.start({
    relayUrl: `http://127.0.0.1:${relay.port}`,
    signer,
    onSession: () => {},
    onUnsignedPairSlot: (slot) => unsigned.push(slot),
  });
  await ready.promise;
  return uplink;
}

const noise = new Uint8Array(32).fill(4);
const expiry = (): number => Date.now() + 10 * 60 * 1000;

describe("Uplink.registerPairSlot (#22, contract v1.9)", () => {
  test("a v1.9 relay gets the signed form, signed by the host's own key, and nothing unsigned", async () => {
    relayIsV18 = true;
    seen.length = 0;
    const unsigned: string[] = [];
    const uplink = await start(unsigned);
    expect(await uplink.registerPairSlot("AB3", noise, expiry())).toBe("registered");
    expect(seen).toEqual([{ slot: "AB3", signed: true, ok: true }]);
    expect(unsigned).toEqual([]);
    uplink.stop();
  });

  test("an older relay's Malformed sends that one request unsigned, and every later request tries signed again", async () => {
    relayIsV18 = false;
    seen.length = 0;
    const unsigned: string[] = [];
    const uplink = await start(unsigned);
    expect(await uplink.registerPairSlot("AB3", noise, expiry())).toBe("registered");
    expect(await uplink.registerPairSlot("CD4", noise, expiry())).toBe("registered");
    expect(seen).toEqual([
      { slot: "AB3", signed: true, ok: true },
      { slot: "AB3", signed: false, ok: false },
      { slot: "CD4", signed: true, ok: true },
      { slot: "CD4", signed: false, ok: false },
    ]);
    // The downgrade is told once per connection, not once per request.
    expect(unsigned).toEqual(["AB3"]);

    // The relay is updated: the very next registration is signed and accepted, with no restart.
    relayIsV18 = true;
    expect(await uplink.registerPairSlot("EF5", noise, expiry())).toBe("registered");
    expect(seen.at(-1)).toEqual({ slot: "EF5", signed: true, ok: true });
    expect(seen).toHaveLength(5);
    uplink.stop();
  });
});
