import { describe, expect, test } from "bun:test";
import { WsByteLink } from "./e2ee/links.ts";
import { rawWsClient, serveWsLinks } from "./testing/ws-harness.ts";

const BIG = new Uint8Array(4 * 1024 * 1024);

/** Whether `promise` is still pending once the event loop has turned. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const turn = new Promise<"pending">((resolve) => setImmediate(() => resolve("pending")));
  return (await Promise.race([promise.then(() => "settled"), turn])) === "pending";
}

/** The server's frames (unmasked) in `bytes`: opcode and payload of each complete frame. */
function serverFrames(bytes: Uint8Array): { readonly opcode: number; readonly payload: Uint8Array }[] {
  const frames: { readonly opcode: number; readonly payload: Uint8Array }[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 2 <= bytes.byteLength) {
    const opcode = view.getUint8(at) & 0x0f;
    const short = view.getUint8(at + 1) & 0x7f;
    const headerLength = short === 126 ? 4 : short === 127 ? 10 : 2;
    if (at + headerLength > bytes.byteLength) break;
    const length = short === 126 ? view.getUint16(at + 2) : short === 127 ? Number(view.getBigUint64(at + 2)) : short;
    if (at + headerLength + length > bytes.byteLength) break;
    frames.push({ opcode, payload: bytes.subarray(at + headerLength, at + headerLength + length) });
    at += headerLength + length;
  }
  return frames;
}

describe("WsLink over a real socket", () => {
  test("a socket whose reads the host holds back is not closed as idle", async () => {
    const server = serveWsLinks({ keepaliveIdleMs: 150 });
    try {
      const linked = server.nextLink();
      const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
      const link = await linked;
      const held = Promise.withResolvers<void>();
      link.onData(() => held.promise);
      await new Promise((resolve) => client.addEventListener("open", resolve));
      client.send(Uint8Array.of(1));
      client.send(Uint8Array.of(2));
      await Bun.sleep(450);
      expect(client.readyState).toBe(WebSocket.OPEN);
      held.resolve();
      client.close(1000);
    } finally {
      await server.stop();
    }
  });

  test("flushed() stays pending while the peer is not reading and settles after the drain", async () => {
    const server = serveWsLinks();
    try {
      const linked = server.nextLink();
      const client = await rawWsClient(server.port);
      const wire = new WsByteLink(await linked);
      client.socket.pause();
      wire.send(BIG);
      wire.send(Uint8Array.of(1));
      expect(await isPending(wire.flushed())).toBe(true);
      client.socket.resume();
      await wire.flushed();
      client.socket.destroy();
    } finally {
      await server.stop();
    }
  });

  test("pings that arrive while the socket is backpressured queue no pongs", async () => {
    const server = serveWsLinks({ keepaliveIdleMs: 60_000 });
    try {
      const linked = server.nextLink();
      const client = await rawWsClient(server.port);
      const link = await linked;
      const reached = Promise.withResolvers<void>();
      link.onData(() => reached.resolve());
      client.socket.pause();
      const backlog = link.send(BIG);
      for (let ping = 0; ping < 20; ping++) client.sendText("ping");
      client.sendBinary(Uint8Array.of(9));
      await reached.promise;
      client.socket.resume();
      await backlog;
      const marker = Uint8Array.of(7, 7, 7);
      const seen = Promise.withResolvers<void>();
      client.socket.on("data", () => {
        if (serverFrames(client.received()).some((frame) => frame.payload.toHex() === marker.toHex())) seen.resolve();
      });
      await link.send(marker);
      await seen.promise;
      const pongs = serverFrames(client.received()).filter((frame) => frame.opcode === 0x1);
      expect(pongs.length).toBeLessThanOrEqual(1);
      client.socket.destroy();
    } finally {
      await server.stop();
    }
  });

  test("a write the socket drops closes the link without an unhandled rejection", async () => {
    const server = serveWsLinks({ backpressureLimit: 64 * 1024 });
    try {
      const linked = server.nextLink();
      const client = await rawWsClient(server.port);
      const link = await linked;
      const wire = new WsByteLink(link);
      const closed = Promise.withResolvers<void>();
      link.onClose(() => closed.resolve());
      client.socket.pause();
      for (let write = 0; write < 8; write++) wire.send(new Uint8Array(256 * 1024));
      await closed.promise;
      await new Promise((resolve) => setImmediate(resolve));
      client.socket.destroy();
    } finally {
      await server.stop();
    }
  });
});
