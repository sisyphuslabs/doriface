import { afterAll, describe, expect, test } from "bun:test";
import { connectRelayClient } from "./connector.ts";
import { RelayCloseError } from "./link.ts";
import { relaySocketUrl } from "./socket.ts";

const urls: URL[] = [];
const refusing = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, server) => {
    urls.push(new URL(request.url));
    return server.upgrade(request) ? undefined : new Response("upgrade", { status: 426 });
  },
  websocket: { open: (ws) => ws.close(4412, "relay pass refused"), message: () => undefined },
});
afterAll(() => refusing.stop(true));

/** The relay closes every session at once: wait for that close, whether it came before or after the open. */
async function untilClosed(connecting: Promise<{ onClose(listener: () => void): unknown }>): Promise<void> {
  const link = await connecting.catch(() => undefined);
  if (link !== undefined) await new Promise<void>((resolve) => link.onClose(() => resolve()));
}

const hostId = "a".repeat(26);

/**
 * A socket that closes with Normal (1000) before it opens: that close carries no RelayCloseError, so the connector writes
 * the error itself. The close is dispatched once the connector has subscribed; the real socket's later failure is
 * ignored by the already closed link.
 */
function closedNormallyBeforeOpen(url: string): WebSocket {
  const ws = new WebSocket(url);
  queueMicrotask(() => ws.dispatchEvent(new CloseEvent("close", { code: 1000 })));
  return ws;
}

/** A listener that accepts the TCP connection and never answers the upgrade, so the socket stays CONNECTING. */
function aRelayThatNeverAnswers(): { readonly port: number; readonly stop: () => void } {
  const server = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data: () => undefined, open: () => undefined, close: () => undefined },
  });
  return { port: server.port, stop: () => void server.stop(true) };
}

describe("a relay that never answers the upgrade", () => {
  test("fails at its bound, closing the socket, instead of holding the connect open", async () => {
    const relay = aRelayThatNeverAnswers();
    const settled = Promise.withResolvers<WebSocket>();
    const createSocket = (url: string): WebSocket => {
      const socket = new WebSocket(url);
      socket.addEventListener("close", () => settled.resolve(socket), { once: true });
      socket.addEventListener("error", () => settled.resolve(socket), { once: true });
      return socket;
    };
    try {
      const error = await Promise.race([
        connectRelayClient({
          relayUrl: `http://127.0.0.1:${relay.port}`,
          hostId,
          timeoutMs: 80,
          createSocket,
        }).then(
          () => "opened",
          (caught: unknown) => caught,
        ),
        Bun.sleep(2_000).then(() => "still dialing"),
      ]);
      expect(String(error)).toContain(`did not open within 80 ms`);
      const socket = await Promise.race([settled.promise, Bun.sleep(2_000).then(() => undefined)]);
      expect(socket?.readyState).not.toBe(WebSocket.CONNECTING);
    } finally {
      relay.stop();
    }
  });

  test("is abandoned at once when the caller cancels, and its socket is closed", async () => {
    const relay = aRelayThatNeverAnswers();
    const cancelled = new AbortController();
    const closed = Promise.withResolvers<string>();
    const createSocket = (url: string): WebSocket => {
      const socket = new WebSocket(url);
      socket.addEventListener("close", () => closed.resolve("close"), { once: true });
      socket.addEventListener("error", () => closed.resolve("error"), { once: true });
      return socket;
    };
    try {
      const dialing = connectRelayClient({
        relayUrl: `http://127.0.0.1:${relay.port}`,
        hostId,
        createSocket,
        signal: cancelled.signal,
      });
      cancelled.abort(new Error("the person changed the settings"));
      const error = await Promise.race([
        dialing.then(
          () => "opened",
          (caught: unknown) => caught,
        ),
        Bun.sleep(2_000).then(() => "still dialing"),
      ]);
      expect(String(error)).toContain("the person changed the settings");
      expect(await Promise.race([closed.promise, Bun.sleep(2_000).then(() => "still connecting")])).not.toBe(
        "still connecting",
      );
    } finally {
      relay.stop();
    }
  });
});

describe("relay URLs", () => {
  test("a relay URL without a scheme is reported as such", () => {
    expect(() => relaySocketUrl("relay.example", "/v1/client/x")).toThrow("relay URL must be http(s) or ws(s)");
  });

  test("connectRelayClient reports a bad relay URL as a rejection, never a synchronous throw", async () => {
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = connectRelayClient({ relayUrl: "relay.example", hostId });
    }).not.toThrow();
    await expect(pending).rejects.toThrow("relay URL must be http(s) or ws(s)");
  });
});

describe("relay passes on client sessions (contract v1.6)", () => {
  test("the session carries the proof, and a 4412 tells the passes which relay refused it", async () => {
    const refused: [string, string][] = [];
    const proofs = {
      proof: (role: string, target: string, origin: string) => `${role}.${target.slice(0, 4)}.${origin.length}`,
      refused: (origin: string, proof: string) => refused.push([origin, proof]),
    };
    await untilClosed(connectRelayClient({ relayUrl: `http://127.0.0.1:${refusing.port}`, hostId, proofs }));
    const origin = `ws://127.0.0.1:${refusing.port}`;
    expect(urls.at(-1)?.searchParams.get("proof")).toBe(`client.aaaa.${origin.length}`);
    expect(refused).toEqual([[origin, `client.aaaa.${origin.length}`]]);
  });

  test("a session closed normally before opening names only its path in the error, so no log can carry the proof", async () => {
    const gone = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("gone") });
    const { port } = gone;
    await gone.stop(true);
    const proofs = { proof: () => "SECRET-PROOF-TEXT", refused: () => undefined };
    const error = await connectRelayClient({
      relayUrl: `http://127.0.0.1:${port}`,
      hostId,
      proofs,
      createSocket: closedNormallyBeforeOpen,
    }).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(RelayCloseError);
    expect(String(error)).toBe(
      `Error: relay socket to ws://127.0.0.1:${port}/v1/client/${hostId} closed before opening`,
    );
  });

  test("only a 4412 is a refusal: a session closed for any other reason marks no pass", async () => {
    const limiting = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade", { status: 426 })),
      websocket: { open: (ws) => ws.close(4429, "rate limited"), message: () => undefined },
    });
    const refused: string[] = [];
    const proofs = { proof: () => "proof", refused: (origin: string) => void refused.push(origin) };
    await untilClosed(connectRelayClient({ relayUrl: `http://127.0.0.1:${limiting.port}`, hostId, proofs }));
    await limiting.stop(true);
    expect(refused).toEqual([]);
  });

  test("without a pass the session dials as before, with no proof", async () => {
    await untilClosed(
      connectRelayClient({
        relayUrl: `http://127.0.0.1:${refusing.port}`,
        hostId,
        proofs: { proof: () => undefined, refused: () => undefined },
      }),
    );
    expect(urls.at(-1)?.searchParams.has("proof")).toBe(false);
  });
});
