import { describe, expect, test } from "bun:test";
import { isLoopbackHost, LoopbackAddressError, loopbackOnly } from "./loopback-address.ts";

describe("a dial that carries the loopback token goes to this computer only (#462)", () => {
  test.each([
    ["ws://127.0.0.1:51234/v1/hc", "hc"],
    ["ws://127.1.2.3:7766/v1/hc", "hc"],
    ["ws://[::1]:7766/v1/hc", "hc"],
    ["ws://localhost:7766/v1/push", "push"],
    ["wss://localhost:7766/v1/hc", "hc"],
  ] as const)("%s is allowed for %s", (url, kind) => {
    expect(loopbackOnly(url, kind)).toBe(url);
  });

  test.each([
    ["ws://192.168.1.20:7766/v1/hc", "hc"],
    ["ws://0.0.0.0:7766/v1/hc", "hc"],
    ["ws://studio.local:7766/v1/hc", "hc"],
    ["ws://localhost.example:7766/v1/hc", "hc"],
    ["wss://relay.example/v1/hc", "hc"],
    ["http://127.0.0.1:7766/v1/hc", "hc"],
    ["ws://user:pass@127.0.0.1:7766/v1/hc", "hc"],
    ["ws://127.0.0.1:7766/v1/push", "hc"],
    ["ws://127.0.0.1:7766/v1/hc", "push"],
    ["ws://127.0.0.1:7766/v1/hc?token=x", "hc"],
    ["ws://127.0.0.1:7766/v1/hc#x", "hc"],
    ["garbage", "hc"],
  ] as const)("%s is refused for %s", (url, kind) => {
    expect(() => loopbackOnly(url, kind)).toThrow(LoopbackAddressError);
  });

  test.each([
    ["127.0.0.1", true],
    ["127.255.0.9", true],
    ["[::1]", true],
    ["localhost", true],
    ["128.0.0.1", false],
    ["0.0.0.0", false],
    ["127.0.0.1.example", false],
    ["localhost.example", false],
  ])("%s is loopback: %s", (host, loopback) => {
    expect(isLoopbackHost(host)).toBe(loopback);
  });
});
