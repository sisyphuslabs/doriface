import { afterEach, expect, test } from "bun:test";
import type { Socket } from "bun";
import { makeTap, type Tap } from "./tap.ts";

const HEAD = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n";

/** An unmasked WebSocket close frame with `code`, as a relay sends it. */
function closeFrame(code: number): Uint8Array {
  const out = new Uint8Array([0x88, 2, 0, 0]);
  new DataView(out.buffer).setUint16(2, code);
  return out;
}

/** A raw upstream that hands each connection to the test by the request line the tap forwarded. */
function upstream(): { port: number; accepted(path: string): Promise<Socket<undefined>>; stop(): void } {
  const waiting = new Map<string, PromiseWithResolvers<Socket<undefined>>>();
  const slot = (path: string) => waiting.get(path) ?? waiting.set(path, Promise.withResolvers()).get(path);
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, bytes) {
        const path = /^GET (\S+)/.exec(Buffer.from(bytes).toString("latin1"))?.[1];
        if (path !== undefined) slot(path)?.resolve(socket);
      },
    },
  });
  return {
    port: server.port,
    accepted: (path) => slot(path)?.promise ?? Promise.reject(new Error("no slot")),
    stop: () => server.stop(true),
  };
}

/** A host-side connection through the tap that resolves `received` once `count` bytes have come back. */
async function dial(tap: Tap, path: string): Promise<{ until(count: number): Promise<void>; end(): void }> {
  let got = 0;
  const waits: { count: number; done: () => void }[] = [];
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: tap.port,
    socket: {
      data(_socket, bytes) {
        got += bytes.length;
        for (const wait of waits.filter((each) => got >= each.count)) wait.done();
      },
    },
  });
  socket.write(`GET ${path} HTTP/1.1\r\nHost: relay.test\r\n\r\n`);
  return {
    until: (count) =>
      got >= count ? Promise.resolve() : new Promise((done) => void waits.push({ count, done: () => done() })),
    end: () => socket.end(),
  };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const each of cleanup.splice(0)) each();
});

test("close codes are kept in arrival order, so a mark by count never drops a later code on an older connection", async () => {
  const relay = upstream();
  const tap = makeTap(relay.port, "203.0.113.7");
  cleanup = [() => tap.stop(), () => relay.stop()];
  const uplink = await dial(tap, "/v1/host/aaaa");
  const uplinkEnd = await relay.accepted("/v1/host/aaaa");
  uplinkEnd.write(HEAD);
  await uplink.until(HEAD.length);
  const session = await dial(tap, "/v1/client/bbbb");
  const sessionEnd = await relay.accepted("/v1/client/bbbb");
  sessionEnd.write(Buffer.concat([Buffer.from(HEAD, "latin1"), closeFrame(1000)]));
  await session.until(HEAD.length + 4);
  const mark = tap.closeCodes().length;
  uplinkEnd.write(closeFrame(4429));
  await uplink.until(HEAD.length + 4);
  cleanup.push(
    () => uplink.end(),
    () => session.end(),
  );
  expect([mark, tap.closeCodes().slice(mark)]).toEqual([1, [4429]]);
});
