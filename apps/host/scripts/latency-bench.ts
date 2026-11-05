// Times sequential terminal.list round trips through the client SDK, as docs/architecture.md section 5 reports them:
//   bun apps/host/scripts/latency-bench.ts relay --relay <url> --code <code shown by doriface-host pair>
//   bun apps/host/scripts/latency-bench.ts direct [--hc <path>] [--session <name>]
// The relay mode pairs a throwaway device key by the typed code, then opens a Noise IK session through the relay.
import { type ByteLink, HcConnection } from "@doriface/client";
import { generateX25519, rawStaticKey, secureLink } from "@doriface/crypto";
import { connectRelayClient, lookupPairSlot, pairSlotOf } from "@doriface/relay-client";
import { parseArgs } from "node:util";
import { ProcessLink } from "@doriface/client/process-link";
import { measure, summarize } from "./bench-stats.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    relay: { type: "string" },
    code: { type: "string" },
    hc: { type: "string", default: "hc" },
    session: { type: "string" },
    calls: { type: "string", default: "200" },
    warmup: { type: "string", default: "10" },
  },
});

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

function directLink(hc: string, session: string | undefined): ByteLink {
  const args = session === undefined ? [] : ["--session", session];
  return new ProcessLink(Bun.spawn([hc, "connect", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
}

const [mode] = positionals;
let link: ByteLink;
if (mode === "relay") {
  if (values.relay === undefined || values.code === undefined) throw new Error("relay mode needs --relay and --code");
  link = await (await relayLink(values.relay, values.code)).open();
} else if (mode === "direct") {
  link = directLink(values.hc, values.session);
} else {
  throw new Error(
    "usage: latency-bench.ts relay --relay <url> --code <code> | direct [--hc <path>] [--session <name>]",
  );
}
const connection = await HcConnection.open(link);
const { samples } = await measure(() => connection.call("terminal.list", {}, { timeoutMs: 15_000 }), {
  calls: Number(values.calls),
  warmup: Number(values.warmup),
});
connection.close();
process.stdout.write(`${JSON.stringify({ mode, ...summarize(samples) })}\n`);
process.exit(0);
