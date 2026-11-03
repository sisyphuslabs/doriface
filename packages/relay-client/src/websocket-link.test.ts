import { afterEach, describe, expect, test } from "bun:test";
import { RelayCloseError } from "./link.ts";
import { ACK_INTERVAL_BYTES, CloseCode, SESSION_WINDOW_BYTES } from "./wire/index.ts";
import { WebSocketLink } from "./websocket-link.ts";

type Peer = Bun.ServerWebSocket<undefined>;

interface FakeRelay {
  readonly url: string;
  readonly peer: Promise<Peer>;
  /** The next message the link sent, in order. */
  next(): Promise<string | Uint8Array>;
  readonly closed: Promise<number>;
}

const servers: Bun.Server<undefined>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

function fakeRelay(): FakeRelay {
  const peer = Promise.withResolvers<Peer>();
  const closed = Promise.withResolvers<number>();
  const received: (string | Uint8Array)[] = [];
  let wake: (() => void) | undefined;
  const next = async (): Promise<string | Uint8Array> => {
    const [message] = received.splice(0, 1);
    if (message !== undefined) return message;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    return next();
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request, srv) =>
      srv.upgrade(request, { data: undefined }) ? undefined : new Response("no", { status: 400 }),
    websocket: {
      open: (ws) => peer.resolve(ws),
      message: (_ws, message) => {
        received.push(typeof message === "string" ? message : new Uint8Array(message));
        wake?.();
      },
      close: (_ws, code) => closed.resolve(code),
    },
  });
  servers.push(server);
  return { url: `ws://127.0.0.1:${server.port}`, peer: peer.promise, next, closed: closed.promise };
}

async function openLink(relay: FakeRelay, credit = false): Promise<WebSocketLink> {
  const ws = new WebSocket(relay.url);
  const link = new WebSocketLink(ws, undefined, { credit });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("close", (event: CloseEvent) => reject(new Error(`closed with ${event.code} before opening`)), {
      once: true,
    });
  });
  return link;
}

const closeError = (link: WebSocketLink): Promise<Error | undefined> => new Promise((resolve) => link.onClose(resolve));

describe("WebSocketLink", () => {
  test("with credit, sends past the window wait for the relay's c:<n> and go in order", async () => {
    const relay = fakeRelay();
    const link = await openLink(relay, true);
    const peer = await relay.peer;
    const marker = new Promise<Uint8Array>((resolve) => link.onData(resolve));
    peer.send("c:0");
    peer.send(new Uint8Array([7]));
    await marker;
    const half = SESSION_WINDOW_BYTES / 2 + 1;
    for (const fill of [1, 2, 3]) link.send(new Uint8Array(half).fill(fill));
    const first = await relay.next();
    expect(first instanceof Uint8Array ? first[0] : first).toBe(1);
    const drained = link.drained();
    peer.send(`c:${half}`);
    const second = await relay.next();
    expect(second instanceof Uint8Array ? second[0] : second).toBe(2);
    peer.send(`c:${half}`);
    const third = await relay.next();
    expect(third instanceof Uint8Array ? third[0] : third).toBe(3);
    await drained;
    link.close();
  });

  test("with credit, a text that is not c:<n> still closes with 1003, not as bad credit", async () => {
    const relay = fakeRelay();
    const link = await openLink(relay, true);
    const closed = closeError(link);
    (await relay.peer).send("hello");
    const error = await closed;
    expect(error instanceof RelayCloseError ? error.code : error).toBe(CloseCode.UnsupportedData);
  });

  test("a c:<n> crediting more than is in flight closes the link with 4402", async () => {
    const relay = fakeRelay();
    const link = await openLink(relay, true);
    const closed = closeError(link);
    (await relay.peer).send("c:1");
    const error = await closed;
    expect(error instanceof RelayCloseError ? error.code : error).toBe(CloseCode.RelayProtocolError);
  });

  test("a text frame other than pong closes the link with 1003 and the socket with a sendable code", async () => {
    const relay = fakeRelay();
    const link = await openLink(relay);
    const closed = closeError(link);
    (await relay.peer).send("hello");
    const error = await closed;
    expect(error instanceof RelayCloseError ? error.code : error).toBe(CloseCode.UnsupportedData);
    expect(link.closeCode).toBe(CloseCode.UnsupportedData);
    expect(await relay.closed).toBe(CloseCode.Normal);
  });

  test("a throwing data listener closes the link with 1011 and keeps the listener's error as the cause", async () => {
    const relay = fakeRelay();
    const link = await openLink(relay);
    const failure = new Error("listener bug");
    link.onData(() => {
      throw failure;
    });
    const closed = closeError(link);
    (await relay.peer).send(new Uint8Array([1]));
    const error = await closed;
    expect(error instanceof RelayCloseError ? [error.code, error.cause] : error).toEqual([
      CloseCode.InternalError,
      failure,
    ]);
    expect(await relay.closed).toBe(CloseCode.Normal);
  });

  test("acks bytes only once the data listeners have consumed them", async () => {
    const relay = fakeRelay();
    const link = await openLink(relay);
    const consumed = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    link.onData(() => {
      delivered.resolve();
      return consumed.promise;
    });
    (await relay.peer).send(new Uint8Array(ACK_INTERVAL_BYTES));
    await delivered.promise;
    link.send(new Uint8Array([7]));
    expect(await relay.next()).toEqual(new Uint8Array([7]));
    consumed.resolve();
    expect(await relay.next()).toBe(`a:${ACK_INTERVAL_BYTES}`);
    link.close();
  });
});
