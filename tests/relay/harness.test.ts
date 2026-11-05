import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replyDifference, taps } from "./support/byte-tap.ts";
import { rethrowAfter, type SetupError, settleAll } from "./support/settle.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the relay harness (#40)", () => {
  test("a reply that differs names hc's bytes as the expected ones and the client's as what it got", () => {
    const message = replyDifference({ pid: "1", read: bytes(""), wrote: bytes("from hc") }, bytes("from client"));
    expect(message).toContain('expected "from hc"');
    expect(message).toContain('got "from client"');
  });

  test("a tap with no file yet reads as empty; any other read error is thrown, not read as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-taps-"));
    try {
      mkdirSync(join(dir, "taps"));
      writeFileSync(join(dir, "taps", "7.in"), "sent");
      expect(taps(dir).map((tap) => [tap.pid, tap.read.byteLength, tap.wrote.byteLength])).toEqual([["7", 4, 0]]);
      // A directory where the output file should be: reading it fails with EISDIR.
      mkdirSync(join(dir, "taps", "7.out"));
      expect(() => taps(dir)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a teardown runs every step after one fails, and returns every failure", async () => {
    const ran: string[] = [];
    const failures = await settleAll([
      () => {
        ran.push("host");
        throw new Error("host stop failed");
      },
      () => {
        ran.push("session");
      },
      async () => {
        ran.push("relay");
        await Promise.reject(new Error("relay stop failed"));
      },
    ]);
    expect(ran).toEqual(["host", "session", "relay"]);
    expect(failures.map(String)).toEqual(["Error: host stop failed", "Error: relay stop failed"]);
  });

  test("a failed setup rethrows its own error, with the teardown's failures attached", async () => {
    const setup = new Error("the uplink never connected");
    const thrown = await rethrowAfter(setup, [
      () => {
        throw new Error("host stop failed");
      },
    ]).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBe(setup);
    expect((thrown as SetupError).teardown?.map(String)).toEqual(["Error: host stop failed"]);
  });
});
