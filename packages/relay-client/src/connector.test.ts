import { describe, expect, test } from "bun:test";
import { connectRelayClient } from "./connector.ts";
import { relaySocketUrl } from "./socket.ts";

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
