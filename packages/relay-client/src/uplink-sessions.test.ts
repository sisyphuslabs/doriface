import { afterAll, expect, test } from "bun:test";
import { ed25519Signer, generateSigningKey } from "./signer.ts";
import { Uplink } from "./uplink.ts";
import { decodeMux, encodeData, encodeOpen, MuxType, parseAck } from "./wire/index.ts";

const CHUNK = 64 * 1024;
const STALLED_BYTES = 5 * 1024 * 1024;
let sent = 0;
let highestAck = 0;
const acked = Promise.withResolvers<void>();
const stalledClosed = Promise.withResolvers<number>();
const otherClosed: number[] = [];

const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade", { status: 426 })),
  websocket: {
    open: (ws) => {
      ws.send(new Uint8Array(32));
      sent += 32;
    },
    message: (ws, message) => {
      if (typeof message === "string") {
        highestAck = Math.max(highestAck, parseAck(message) ?? 0);
        if (highestAck > sent - CHUNK && sent > STALLED_BYTES) acked.resolve();
        return;
      }
      if (message.byteLength === 96) return feed(ws);
      const frame = decodeMux(message);
      if (frame.type !== MuxType.Close) return;
      if (frame.sessionId === 1) stalledClosed.resolve(frame.code);
      else otherClosed.push(frame.code);
    },
  },
});
afterAll(() => relay.stop(true));

function feed(ws: { send(bytes: Uint8Array): unknown }): void {
  const send = (bytes: Uint8Array): void => {
    ws.send(bytes);
    sent += bytes.byteLength;
  };
  send(encodeOpen(1));
  send(encodeOpen(2));
  for (let total = 0; total < STALLED_BYTES; total += CHUNK) send(encodeData(1, new Uint8Array(CHUNK)));
  send(encodeData(2, new Uint8Array([7])));
}

test("a stalled session is closed alone with 4408 while the uplink keeps acking for the others", async () => {
  const otherData = Promise.withResolvers<Uint8Array>();
  const uplink = await Uplink.start({
    relayUrl: `http://127.0.0.1:${relay.port}`,
    signer: ed25519Signer(generateSigningKey()),
    onSession: (session) => {
      if (session.sessionId === 1) session.onData(() => new Promise<void>(() => {}));
      else session.onData((bytes) => otherData.resolve(bytes));
    },
  });
  expect(await stalledClosed.promise).toBe(4408);
  expect(await otherData.promise).toEqual(new Uint8Array([7]));
  await acked.promise;
  expect(otherClosed).toEqual([]);
  uplink.stop();
}, 20_000);
