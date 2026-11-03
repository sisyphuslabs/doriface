import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { startRelayedHost } from "./support/relayed-host.ts";

const scratchDirs = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("rh-"));

describe("startRelayedHost", () => {
  test("an uplink that never connects rejects within its bound and tears everything down", async () => {
    const before = new Set(scratchDirs());
    const startedAt = performance.now();
    const failure = await startRelayedHost("relay-unreachable", {
      hostRelayUrl: "http://127.0.0.1:9",
      uplinkTimeoutMs: 2_000,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("the host's relay uplink did not happen within 2000 ms");
    expect(performance.now() - startedAt).toBeLessThan(60_000);
    expect(scratchDirs().filter((name) => !before.has(name))).toEqual([]);
  }, 120_000);
});
