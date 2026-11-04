import { afterAll, describe, expect, test } from "bun:test";
import { connectRelayClient } from "./connector.ts";
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

  test("a session that fails before opening names no proof in its error, so no log can carry one", async () => {
    const gone = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("gone") });
    const relayUrl = `http://127.0.0.1:${gone.port}`;
    await gone.stop(true);
    const proofs = { proof: () => "SECRET-PROOF-TEXT", refused: () => undefined };
    const error = await connectRelayClient({ relayUrl, hostId, proofs }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("SECRET-PROOF-TEXT");
    expect(String(error)).not.toContain("proof=");
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
