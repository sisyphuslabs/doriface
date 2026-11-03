import { encodeFrame, FrameKind, RPC_CHANNEL } from "@doriface/protocol";
import { ACK_INTERVAL_BYTES, type CreateSocket } from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dial } from "../../apps/host/src/connect/dial.ts";
import { pipe } from "../../apps/host/src/connect/pipe.ts";
import { loadDeviceKey } from "../../apps/host/src/state/known-hosts.ts";
import { HELLO } from "../../apps/host/src/testing/hc-session.ts";
import { runConnect } from "./support/connect-cli.ts";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { within } from "./support/watch.ts";

const MIB = 1024 * 1024;
const encoder = new TextEncoder();
const scratch = mkdtempSync(join(tmpdir(), "bp-"));
const deviceState = join(scratch, "device");
let relayed: RelayedHost | undefined;

beforeAll(async () => {
  relayed = await startRelayedHost("relay-backpressure");
  const pairing = runConnect(deviceState, relayed.relayUrl, await relayed.pairingLink(), "--name", "slow");
  pairing.end();
  if ((await pairing.exited) !== 0) throw new Error(`pairing failed: ${await pairing.stderr()}`);
}, 120_000);

afterAll(async () => {
  await relayed?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

/** A socket that counts the binary bytes it receives and keeps the acks it sends. */
function countingSocket(ip: string): {
  readonly create: CreateSocket;
  readonly received: () => number;
  readonly acked: () => number;
  readonly reached: (bytes: number) => Promise<void>;
} {
  let received = 0;
  let acked = 0;
  const waits: { readonly bytes: number; readonly resolve: () => void }[] = [];
  class Counting extends WebSocket {
    override send(data: Parameters<WebSocket["send"]>[0]): void {
      const total = typeof data === "string" ? /^a:(\d+)$/.exec(data)?.[1] : undefined;
      if (total !== undefined) acked = Number(total);
      super.send(data);
    }
  }
  const create: CreateSocket = (url) => {
    const ws = new Counting(url, { headers: { "cf-connecting-ip": ip } });
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      received += event.data.byteLength;
      for (const wait of waits.filter((entry) => received >= entry.bytes)) wait.resolve();
    });
    return ws;
  };
  const reached = (bytes: number): Promise<void> => {
    if (received >= bytes) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waits.push({ bytes, resolve });
    return promise;
  };
  return { create, received: () => received, acked: () => acked, reached };
}

describe("doriface-host connect with a stdout that stops taking bytes", () => {
  test("the bridge stops reading and acking the relay, and catches up once stdout drains", async () => {
    if (relayed === undefined) throw new Error("setup failed");
    const dir = join(relayed.scratch, "work");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "mib.txt");
    writeFileSync(file, `${"q".repeat(63)}\n`.repeat(MIB / 64));
    const socket = countingSocket(relayed.ip);
    const dialed = await dial(
      { kind: "host", hostId: relayed.hostId },
      {
        stateDir: deviceState,
        device: loadDeviceKey(deviceState),
        relayUrl: relayed.relayUrl,
        defaultRelayUrl: relayed.relayUrl,
        deviceName: "slow",
        log: () => {},
        createSocket: socket.create,
      },
    );
    const stdinOpen = Promise.withResolvers<void>();
    const requests = [1, 2, 3].map((id) =>
      encodeFrame(
        RPC_CHANNEL,
        FrameKind.Data,
        encoder.encode(
          JSON.stringify({ jsonrpc: "2.0", id, method: "file.read", params: { path: file, limit: 20_000 } }),
        ),
      ),
    );
    async function* input(): AsyncIterable<Uint8Array> {
      yield HELLO;
      yield* requests;
      await stdinOpen.promise;
    }
    let written = 0;
    let full = true;
    const drained = Promise.withResolvers<void>();
    const caughtUp = Promise.withResolvers<void>();
    const output = {
      write(bytes: Uint8Array): boolean {
        written += bytes.byteLength;
        if (written >= 3 * MIB) caughtUp.resolve();
        return !full;
      },
      drained: () => (full ? drained.promise : Promise.resolve()),
    };
    const ended = pipe({ ...dialed, input: input(), output });

    await within(socket.reached(400 * 1024), "400 KiB reaching the bridge's socket");
    expect(written).toBeLessThanOrEqual(65_535);
    expect(socket.acked()).toBeLessThanOrEqual(2 * ACK_INTERVAL_BYTES);

    full = false;
    drained.resolve();
    await within(caughtUp.promise, "every reply once stdout drains", 30_000);
    expect(socket.received()).toBeGreaterThan(3 * MIB);
    stdinOpen.resolve();
    expect(await within(ended, "the pipe ending")).toBeUndefined();
  }, 60_000);
});
