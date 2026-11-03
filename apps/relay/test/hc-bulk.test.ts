import type { HcConnection } from "@doriface/client";
import { generateX25519 } from "@doriface/crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { watchScreen, within } from "./support/watch.ts";

const phone = generateX25519();
const MIB = 1024 * 1024;
let relayed: RelayedHost | undefined;
let connection: HcConnection | undefined;

function started(): { readonly hc: HcConnection; readonly dir: string } {
  if (relayed === undefined || connection === undefined) throw new Error("setup failed");
  return { hc: connection, dir: join(relayed.scratch, "work") };
}

beforeAll(async () => {
  relayed = await startRelayedHost("doriface-relay-bulk");
  mkdirSync(join(relayed.scratch, "work"));
  await relayed.pair(phone, "bulk");
  connection = await relayed.connect(phone);
}, 120_000);

afterAll(async () => {
  connection?.close();
  await relayed?.stop();
});

describe("frames and streams far past one relay message, through the relay", () => {
  test("a 6 MiB file.write (one 8 MiB frame) and its file.read reply arrive whole", async () => {
    const { hc, dir } = started();
    const path = join(dir, "big.txt");
    const line = `${"x".repeat(63)}\n`;
    const content = line.repeat((6 * MIB) / line.length);
    const written = await hc.call("file.write", { path, data: Buffer.from(content).toString("base64") });
    expect(written.bytes).toBe(content.length);
    const read = await hc.call("file.read", { path, limit: 200_000 });
    expect(read.text.length).toBe(content.length);
    expect(read.text === content).toBe(true);
  }, 60_000);

  test("20 MiB of terminal output streams through the relay to its last line on a live session", async () => {
    const { hc, dir } = started();
    const run = await hc.call("terminal.run", { argv: ["/bin/sh"], cwd: dir, env: { PS1: "$ ", HOME: dir } });
    const stream = await hc.attach({ terminal: run.address, cols: 120, rows: 40 });
    const screen = watchScreen(stream);
    stream.write("head -c 20971520 /dev/zero | tr '\\0' 'y'; echo; echo bulk-$((6 * 7))\r");
    await within(screen.line("bulk-42"), "the line after 20 MiB", 50_000);
    expect([hc.closed, stream.state]).toEqual([false, "open"]);
    await hc.call("terminal.kill", { terminal: run.address });
  }, 60_000);
});
