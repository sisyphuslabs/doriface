import { HcConnection } from "@doriface/client";
import { type KeyPair, parsePairingUrl, rawStaticKey, type SecureLink, secureLink } from "@doriface/crypto";
import { type Host, startHost } from "@doriface/host";
import { connectRelayClient, type CreateSocket } from "@doriface/relay-client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHcSession, type HcSession } from "../../../host/src/testing/hc-session.ts";
import { RecordingLink, type Tap, taps, tappedHc } from "./byte-tap.ts";
import { socketFrom, testIp } from "./probe.ts";
import { startLocalRelay } from "./relay-dev.ts";

const CLI = join(import.meta.dir, "..", "..", "..", "host", "src", "cli.ts");

/** A real doriface-host with its own hc core, keeping an uplink to a local relay (wrangler dev). */
export interface RelayedHost {
  readonly relayUrl: string;
  readonly hostId: string;
  readonly hostKey: Uint8Array;
  readonly session: HcSession;
  readonly stateDir: string;
  readonly scratch: string;
  /** Sends the test's own client IP, so the relay's per-IP budgets are this test's alone. */
  readonly createSocket: CreateSocket;
  readonly logs: readonly string[];
  pairingLink(): Promise<string>;
  pair(device: KeyPair, name: string): Promise<void>;
  dial(device: KeyPair): Promise<SecureLink>;
  connect(device: KeyPair): Promise<HcConnection>;
  /** A connection whose plaintext is kept, to compare with what the host's hc read and wrote. */
  connectRecorded(device: KeyPair): Promise<{ readonly connection: HcConnection; readonly link: RecordingLink }>;
  /** What every `hc connect` the host ran read and wrote, recorded before it was passed on. */
  taps(): Tap[];
  stop(): Promise<void>;
}

export async function startRelayedHost(prefix: string): Promise<RelayedHost> {
  const scratch = mkdtempSync(join(tmpdir(), "rh-"));
  const stateDir = join(scratch, "host-state");
  const createSocket = socketFrom(testIp());
  const logs: string[] = [];
  const connected = Promise.withResolvers<void>();
  const relay = await startLocalRelay();
  const session = createHcSession(prefix);
  const tappedHcPath = tappedHc(scratch, session.hc);
  let host: Host | undefined;
  const stop = async (): Promise<void> => {
    if (logs.length > 0) console.log(`host log:\n${logs.join("\n")}`);
    await host?.stop();
    await session.dispose();
    await relay.stop();
    rmSync(scratch, { recursive: true, force: true });
  };
  try {
    host = await startHost({
      listen: { hostname: "127.0.0.1", port: 0 },
      token: "relayed-host-token-relayed-host-token-relayed",
      hc: tappedHcPath,
      session: session.name,
      env: session.env,
      stateDir,
      relay: { url: relay.url, createSocket },
      log: (line) => {
        logs.push(line);
        if (line.startsWith("relay: connected")) connected.resolve();
      },
    });
    await connected.promise;
  } catch (error) {
    await stop();
    throw error;
  }
  const e2ee = host.e2ee;
  if (e2ee === undefined) throw new Error("the host has no E2EE endpoint");

  const pairingLink = async (): Promise<string> => {
    const args = ["pair", "--no-qr", "--web-origin", "https://web.example", "--relay", relay.url];
    const proc = Bun.spawn([process.execPath, CLI, ...args, "--state-dir", stateDir], { stdout: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const url = stdout.split("\n").find((line) => line.startsWith("https://web.example/pair#"));
    if ((await proc.exited) !== 0 || url === undefined) throw new Error(`pair failed: ${stdout}`);
    return url;
  };
  const hostKey = parsePairingUrl(await pairingLink()).noiseStaticPub;
  const open = async (device: KeyPair, linkSecret?: Uint8Array, name?: string): Promise<SecureLink> => {
    const link = await connectRelayClient({ relayUrl: relay.url, hostId: e2ee.hostId, createSocket });
    return secureLink(link, {
      role: "initiator",
      hostId: e2ee.hostId,
      staticKey: rawStaticKey(device),
      remoteStatic: hostKey,
      pairing: linkSecret === undefined ? undefined : { mode: "link", linkSecret, name: name ?? "test device" },
    });
  };
  return {
    relayUrl: relay.url,
    hostId: e2ee.hostId,
    hostKey,
    session,
    stateDir,
    scratch,
    createSocket,
    logs,
    pairingLink,
    async pair(device, name) {
      const { linkSecret } = parsePairingUrl(await pairingLink());
      // The host answers hello on a pairing session only once it stored the device.
      (await HcConnection.open(await open(device, linkSecret, name))).close();
    },
    dial: (device) => open(device),
    connect: async (device) => HcConnection.open(await open(device)),
    async connectRecorded(device) {
      const link = new RecordingLink(await open(device));
      return { connection: await HcConnection.open(link), link };
    },
    taps: () => taps(scratch),
    stop,
  };
}
