import type { HcConnection } from "@doriface/client";
import { generateX25519 } from "@doriface/crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type RelayedHost, startRelayedHost, RELAYED_STOP_MS } from "./support/relayed-host.ts";
import { watchScreen } from "./support/watch.ts";
import { setUpOnce } from "./support/set-up-once.ts";

const phone = generateX25519();
const MIB = 1024 * 1024;

/**
 * The bound for each bulk call (file.write of the 8 MiB frame, file.read of its 6 MiB reply), in place of the client's
 * 20 s default. On agents-seoul-1 at load5 113-123 (ambient), 20 traced round trips with #481's fixes: file.write
 * 1.3-9.8 s (median 3.7 s), file.read 1.6-5.3 s (median 3.7 s). Most of it is the local relay (wrangler dev) passing
 * 8 MiB each way, 2-9 s; E2EE seal and open stay at about 0.1 s CPU each. Worst case with about 3x margin.
 */
export const BULK_CALL_MS = 30_000;
/**
 * The bound for the 8 MiB frame test (both calls and their checks). With #481's fixes at load5 113-123: whole round
 * trips 5.6-13.6 s (traced, n=20) and 16.3 s for the test itself. Worst case with about 3x margin.
 */
export const BULK_FRAME_TEST_MS = 50_000;
/**
 * The bound for 6 MiB up and 20 MiB down at once. With #481's fixes at load5 113-123 (traced, n=20): 5.0-14.6 s
 * (median 7.0-9.1 s); the test itself 10.0 s. Worst case with about 3x margin; the screen wait leaves 5 s for setup.
 */
export const BULK_BOTH_TEST_MS = 45_000;
let relayed: RelayedHost | undefined;
let connection: HcConnection | undefined;

function started(): { readonly hc: HcConnection; readonly dir: string } {
  if (relayed === undefined || connection === undefined) throw new Error("setup failed");
  return { hc: connection, dir: join(relayed.scratch, "work") };
}

setUpOnce(async () => {
  relayed = await startRelayedHost("relay-bulk");
  mkdirSync(join(relayed.scratch, "work"));
  await relayed.pair(phone, "bulk");
  connection = await relayed.connect(phone);
}, 120_000);

afterAll(async () => {
  connection?.close();
  await relayed?.stop();
}, RELAYED_STOP_MS);

describe("frames and streams far past one relay message, through the relay", () => {
  test(
    "a 6 MiB file.write (one 8 MiB frame) and its file.read reply arrive whole",
    async () => {
      const { hc, dir } = started();
      const path = join(dir, "big.txt");
      const line = `${"x".repeat(63)}\n`;
      const content = line.repeat((6 * MIB) / line.length);
      const data = Buffer.from(content).toString("base64");
      const written = await hc.call("file.write", { path, data }, { timeoutMs: BULK_CALL_MS });
      expect(written.bytes).toBe(content.length);
      const read = await hc.call("file.read", { path, limit: 200_000 }, { timeoutMs: BULK_CALL_MS });
      expect(read.text.length).toBe(content.length);
      expect(read.text === content).toBe(true);
    },
    BULK_FRAME_TEST_MS,
  );

  test("20 MiB of terminal output streams through the relay to its last line on a live session", async () => {
    const { hc, dir } = started();
    const run = await hc.call("terminal.run", { argv: ["/bin/sh"], cwd: dir, env: { PS1: "$ ", HOME: dir } });
    const stream = await hc.attach({ terminal: run.address, cols: 120, rows: 40 });
    const screen = watchScreen(stream);
    stream.write("head -c 20971520 /dev/zero | tr '\\0' 'y'; echo; echo bulk-$((6 * 7))\r");
    await screen.line("bulk-42", 50_000);
    expect([hc.closed, stream.state]).toEqual([false, "open"]);
    await hc.call("terminal.kill", { terminal: run.address });
  }, 60_000);

  test(
    "6 MiB up and 20 MiB down at the same time both finish: credit never waits on itself",
    async () => {
      const { hc, dir } = started();
      const run = await hc.call("terminal.run", { argv: ["/bin/sh"], cwd: dir, env: { PS1: "$ ", HOME: dir } });
      const screen = watchScreen(await hc.attach({ terminal: run.address, cols: 120, rows: 40 }));
      const content = `${"z".repeat(63)}\n`.repeat((6 * MIB) / 64);
      const upload = hc.call(
        "file.write",
        { path: join(dir, "both.txt"), data: Buffer.from(content).toString("base64") },
        { timeoutMs: BULK_CALL_MS },
      );
      await hc.call("terminal.send", {
        terminal: run.address,
        text: "head -c 20971520 /dev/zero | tr '\\0' 'y'; echo; echo both-$((6 * 7))",
      });
      const [written] = await Promise.all([upload, screen.line("both-42", BULK_BOTH_TEST_MS - 5_000)]);
      expect(written.bytes).toBe(content.length);
      await hc.call("terminal.kill", { terminal: run.address });
    },
    BULK_BOTH_TEST_MS,
  );
});
