// Times sequential round trips, as docs/architecture.md section 5 reports them, and prints one JSON line:
//   bun apps/host/scripts/latency-bench.ts relay --relay <url> --code <code shown by doriface-host pair>
//   bun apps/host/scripts/latency-bench.ts healthz --relay <url>
//   bun apps/host/scripts/latency-bench.ts direct [--hc <path>]
// relay and direct time `terminal.list` calls through the client SDK; healthz times HTTPS `GET /healthz` on one
// kept-alive connection. Every mode makes --warmup calls first (default 10) and leaves them out of the stats, then
// --calls measured calls (default 200, at least 100). The line names the mode, the target and the machine it ran on,
// so two lines are compared only when their host matches.
// The relay mode pairs a throwaway device key by the typed code, then opens a Noise IK session through the relay.
import { type ByteLink, HcConnection } from "@doriface/client";
import { ProcessLink } from "@doriface/client/process-link";
import { generateX25519, rawStaticKey, relayWebSocketUrl, secureLink } from "@doriface/crypto";
import { connectRelayClient, lookupPairSlot, pairSlotOf } from "@doriface/relay-client";
import { arch, cpus, hostname, loadavg, platform, release } from "node:os";
import { type BenchArgs, parseBenchArgs, USAGE, UsageError } from "./bench-args.ts";
import { type Counts, measure, summarize } from "./bench-stats.ts";

const CALL_TIMEOUT_MS = 15_000;

async function relayLink(relayUrl: string, code: string): Promise<{ readonly open: () => Promise<ByteLink> }> {
  const record = await lookupPairSlot({ relayUrl, code });
  if (record === undefined) throw new Error("no host is pairing with this code on the relay");
  const device = generateX25519();
  const dial = async (pairing: boolean): Promise<ByteLink> => {
    const link = await connectRelayClient({
      relayUrl,
      hostId: record.hostId,
      ...(pairing ? { pairSlot: pairSlotOf(code) } : {}),
    });
    return secureLink(link, {
      role: "initiator",
      hostId: record.hostId,
      staticKey: rawStaticKey(device),
      remoteStatic: record.noiseStaticPub,
      pairing: pairing ? { mode: "code", code, name: "latency-bench" } : undefined,
    });
  };
  (await HcConnection.open(await dial(true))).close();
  return { open: () => dial(false) };
}

/** `terminal.list` round trips over `link`. */
async function timeCalls(link: ByteLink, counts: Counts): Promise<{ readonly hc: string; readonly samples: number[] }> {
  const connection = await HcConnection.open(link);
  try {
    const { samples } = await measure(
      () => connection.call("terminal.list", {}, { timeoutMs: CALL_TIMEOUT_MS }),
      counts,
    );
    return { hc: connection.hello.version, samples: [...samples] };
  } finally {
    connection.close();
  }
}

/** The relay's `GET /healthz`, over HTTPS for an https or wss relay URL. */
function healthzUrl(relay: string): string {
  const url = new URL(relayWebSocketUrl(relay));
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/healthz`;
  return url.href;
}

async function timeHealthz(url: string, counts: Counts): Promise<number[]> {
  const get = async (): Promise<void> => {
    const response = await fetch(url, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  };
  const { samples } = await measure(get, counts);
  return [...samples];
}

/** The machine a line was measured on: lines from different hosts are not an A/B comparison. */
function machine(): Record<string, unknown> {
  const cores = cpus();
  return {
    name: hostname(),
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cores[0]?.model ?? "unknown",
    cores: cores.length,
    load1: loadavg()[0],
  };
}

async function bench(args: BenchArgs): Promise<{ readonly target: string; readonly samples: number[] }> {
  if (args.mode === "relay") {
    const { hc, samples } = await timeCalls(await (await relayLink(args.relay, args.code)).open(), args);
    return { target: `${args.relay} (hc ${hc})`, samples };
  }
  if (args.mode === "healthz") {
    const url = healthzUrl(args.relay);
    return { target: url, samples: await timeHealthz(url, args) };
  }
  const link = new ProcessLink(Bun.spawn([args.hc, "connect"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
  const { hc, samples } = await timeCalls(link, args);
  return { target: `${args.hc} connect (hc ${hc})`, samples };
}

let args: BenchArgs;
try {
  args = parseBenchArgs(Bun.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`latency-bench: ${error.message}\n${USAGE}\n`);
  process.exit(2);
}
const host = machine();
const at = new Date().toISOString();
const { target, samples } = await bench(args);
const line = { mode: args.mode, target, host, at, warmup: args.warmup, ...summarize(samples) };
process.stdout.write(`${JSON.stringify(line)}\n`);
process.exit(0);
