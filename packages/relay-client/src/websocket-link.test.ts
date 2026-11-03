import { afterEach, describe, expect, test } from "bun:test";
import { RelayCloseError } from "./link.ts";
import { CloseCode } from "./wire/index.ts";
import { WebSocketLink } from "./websocket-link.ts";

type Peer = Bun.ServerWebSocket<undefined>;

interface FakeRelay {
  readonly url: string;
  readonly peer: Promise<Peer>;
  readonly received: (string | Uint8Array)[];
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
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request, srv) =>
      srv.upgrade(request, { data: undefined }) ? undefined : new Response("no", { status: 400 }),
    websocket: {
      open: (ws) => peer.resolve(ws),
      message: (_ws, message) => {
        received.push(typeof message === "string" ? message : new Uint8Array(message));
      },
      close: (_ws, code) => closed.resolve(code),
    },
  });
  servers.push(server);
  return { url: `ws://127.0.0.1:${server.port}`, peer: peer.promise, received, closed: closed.promise };
}

async function openLink(relay: FakeRelay): Promise<WebSocketLink> {
  const ws = new WebSocket(relay.url);
  const link = new WebSocketLink(ws);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  return link;
}

const closeError = (link: WebSocketLink): Promise<Error | undefined> => new Promise((resolve) => link.onClose(resolve));

describe("WebSocketLink", () => {
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
});
