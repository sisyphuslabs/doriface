import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { openWebSocketLink } from "./ws-link.ts";

/** A socket the test opens and closes by hand, recording what the link sends. */
class FakeSocket extends EventTarget {
  static last: FakeSocket | null = null;
  readonly sent: unknown[] = [];
  readyState = 0;
  binaryType = "blob";
  constructor() {
    super();
    FakeSocket.last = this;
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "" }));
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
}

const RealWebSocket = globalThis.WebSocket;
beforeEach(() => {
  jest.useFakeTimers();
  Reflect.set(globalThis, "WebSocket", Object.assign(FakeSocket, { OPEN: 1 }));
});
afterEach(() => {
  jest.useRealTimers();
  Reflect.set(globalThis, "WebSocket", RealWebSocket);
});

async function opened(pingEveryMs?: number) {
  const linking = openWebSocketLink("ws://relay.test/", [], pingEveryMs === undefined ? {} : { pingEveryMs });
  const socket = FakeSocket.last;
  if (socket === null) throw new Error("no socket");
  socket.open();
  return { link: await linking, socket };
}

describe("openWebSocketLink keepalive", () => {
  test("sends the text message ping at every interval and stops on close", async () => {
    const { link, socket } = await opened(30_000);
    jest.advanceTimersByTime(90_000);
    expect(socket.sent).toEqual(["ping", "ping", "ping"]);
    link.close();
    jest.advanceTimersByTime(90_000);
    expect(socket.sent).toHaveLength(3);
  });

  test("sends no ping by default", async () => {
    const { socket } = await opened();
    jest.advanceTimersByTime(120_000);
    expect(socket.sent).toEqual([]);
  });
});
