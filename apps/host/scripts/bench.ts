#!/usr/bin/env bun
/**
 * Round-trip latency of `server.status` over a direct `hc connect` versus through doriface-host.
 * Usage: HC_BIN=/path/to/hc bun apps/host/scripts/bench.ts [calls]
 */
import { generateToken } from "../src/auth.ts";
import { startHost } from "../src/host.ts";
import type { ByteReader } from "../src/testing/byte-reader.ts";
import { createHcSession, HELLO, rpcFrame } from "../src/testing/hc-session.ts";
import { openWsClient } from "../src/testing/ws-client.ts";

const CALLS = Number(Bun.argv[2] ?? 1000);
const WARMUP = 50;

interface Transport {
  send(bytes: Uint8Array): Promise<void> | void;
  readonly reader: ByteReader;
}

async function roundTrips(transport: Transport, count: number, firstId: number): Promise<number[]> {
  const samples: number[] = [];
  const call = async (i: number): Promise<void> => {
    if (i === count) return;
    const started = Bun.nanoseconds();
    await transport.send(rpcFrame(firstId + i, "server.status"));
    await transport.reader.frame();
    samples.push((Bun.nanoseconds() - started) / 1e6);
    return call(i + 1);
  };
  await call(0);
  return samples;
}

async function measure(transport: Transport): Promise<number[]> {
  await transport.send(HELLO);
  await transport.reader.line();
  await roundTrips(transport, WARMUP, 1);
  return roundTrips(transport, CALLS, 1 + WARMUP);
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
}

function summary(label: string, samples: readonly number[]): string {
  const sorted = samples.toSorted((a, b) => a - b);
  const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length;
  const cells = [percentile(sorted, 50), percentile(sorted, 95), percentile(sorted, 99), mean].map((v) => v.toFixed(3));
  return `| ${label} | ${samples.length} | ${cells.join(" | ")} |`;
}

const session = createHcSession("doriface-host-bench");
const token = generateToken();
const host = await startHost({
  listen: { hostname: "127.0.0.1", port: 0 },
  token,
  hc: session.hc,
  session: session.name,
  env: session.env,
  log: (line) => process.stderr.write(`${line}\n`),
});
try {
  const direct = session.connect();
  const directSamples = await measure({ send: (bytes) => direct.write(bytes), reader: direct.reader });
  direct.end();
  await direct.exited;

  const client = await openWsClient(host.url, token);
  const hostSamples = await measure({ send: (bytes) => client.socket.send(bytes), reader: client.reader });
  client.socket.close();

  console.log(`server.status round trips, ${CALLS} sequential calls after ${WARMUP} warmup (ms)\n`);
  console.log("| path | calls | p50 | p95 | p99 | mean |");
  console.log("|---|---|---|---|---|---|");
  console.log(summary("direct hc connect", directSamples));
  console.log(summary("via doriface-host (ws)", hostSamples));
} finally {
  await host.stop();
  await session.dispose();
}
