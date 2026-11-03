import { describe, expect, test } from "bun:test";
import { CloseCode } from "./link.ts";
import { MAX_HELD_BYTES } from "./secured-link.ts";
import { established } from "./testing/secure-link-fixture.ts";

describe("held data", () => {
  test("a record that arrives while a listener runs is delivered after the chunks already held", async () => {
    const { client, server } = await established({ synchronous: true });
    client.send(Uint8Array.of(1));
    client.send(Uint8Array.of(2));
    const seen: number[] = [];
    server.onData((chunk) => {
      seen.push(chunk[0] ?? -1);
      if (chunk[0] === 1) client.send(Uint8Array.of(3));
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  test("a listener that closes the link stops the delivery of the rest", async () => {
    const { client, server } = await established({ synchronous: true });
    client.send(Uint8Array.of(1));
    client.send(Uint8Array.of(2));
    const seen: number[] = [];
    server.onData((chunk) => {
      seen.push(chunk[0] ?? -1);
      server.close();
    });
    expect(seen).toEqual([1]);
  });

  test("a peer that closes during a chunked write ends the write quietly", async () => {
    const { client, server } = await established({ synchronous: true });
    server.onData(() => server.close());
    expect(() => client.send(new Uint8Array(200_000))).not.toThrow();
  });

  test("unread data beyond the cap closes the link with 4408", async () => {
    const { client, hostEnd } = await established({ synchronous: true });
    client.send(new Uint8Array(MAX_HELD_BYTES + 1));
    expect(hostEnd.closeCode).toBe(CloseCode.IdleTimeout);
  });
});
