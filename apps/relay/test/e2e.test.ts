import { HcConnection } from "@doriface/client";
import {
  CloseCode,
  generateX25519,
  type KeyPair,
  type PairingLink,
  parsePairingUrl,
  rawStaticKey,
  type SecureLink,
  secureLink,
  SecureLinkError,
} from "@doriface/crypto";
import { type Host, startHost } from "@doriface/host";
import { connectRelayClient, lookupPairSlot, pairSlotOf } from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ByteReader } from "../../host/src/testing/byte-reader.ts";
import { createHcSession, HELLO, type HcSession, rpcFrame } from "../../host/src/testing/hc-session.ts";
import { capturingSockets } from "./support/capture.ts";
import { drainUntil, field, input, type ParsedFrame, replyTo, rpc } from "./support/hc-frames.ts";
import { socketFrom, testIp } from "./support/probe.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";

const CLI = join(import.meta.dir, "..", "..", "host", "src", "cli.ts");
const decoder = new TextDecoder();
const scratch = mkdtempSync(join(tmpdir(), "relay-e2e-"));
const stateDir = join(scratch, "host-state");
const captureFile = join(scratch, "relay-observed.bin");
const ip = testIp();
const sockets = capturingSockets(captureFile, socketFrom(ip));
const phone = generateX25519();
const logs: string[] = [];
const connected = Promise.withResolvers<void>();
let relay: LocalRelay | undefined;
let hc: HcSession | undefined;
let host: Host | undefined;
let paired: { readonly hostId: string; readonly noiseStaticPub: Uint8Array; readonly lookedUp: Uint8Array };

function started(): { readonly relayUrl: string; readonly session: HcSession } {
  if (relay === undefined || hc === undefined || host === undefined) throw new Error("the e2e setup did not finish");
  return { relayUrl: relay.url, session: hc };
}

async function pairOffer(relayUrl: string): Promise<{ readonly link: PairingLink; readonly code: string }> {
  const args = ["pair", "--no-qr", "--web-origin", "https://web.example", "--relay", relayUrl, "--state-dir", stateDir];
  const proc = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const url = stdout.split("\n").find((line) => line.startsWith("https://web.example/pair#"));
  const code = /^code\s+(\S{4}) (\S{4})/m.exec(stdout);
  if ((await proc.exited) !== 0 || url === undefined || code === null) throw new Error(`pair failed: ${stdout}`);
  return { link: parsePairingUrl(url), code: `${code[1]}${code[2]}` };
}

async function dial(key: KeyPair, pairing?: { readonly code: string }): Promise<SecureLink> {
  const { relayUrl } = started();
  const pairSlot = pairing === undefined ? undefined : pairSlotOf(pairing.code);
  const link = await connectRelayClient({
    relayUrl,
    hostId: paired.hostId,
    createSocket: sockets.client,
    ...(pairSlot === undefined ? {} : { pairSlot }),
  });
  return secureLink(link, {
    role: "initiator",
    hostId: paired.hostId,
    staticKey: rawStaticKey(key),
    remoteStatic: paired.noiseStaticPub,
    pairing: pairing === undefined ? undefined : { mode: "code", code: pairing.code, name: "relay e2e" },
  });
}

const fetchFrom = (url: string): Promise<Response> => fetch(url, { headers: { "cf-connecting-ip": ip } });

function readerOf(link: SecureLink): ByteReader {
  const reader = new ByteReader();
  link.onData((bytes) => reader.push(bytes));
  link.onClose(() => reader.end());
  return reader;
}

beforeAll(async () => {
  const localRelay = await startLocalRelay();
  relay = localRelay;
  const session = createHcSession("doriface-relay-e2e");
  hc = session;
  host = await startHost({
    listen: { hostname: "127.0.0.1", port: 0 },
    token: "relay-e2e-token-relay-e2e-token-relay-e2e-tok",
    hc: session.hc,
    session: session.name,
    env: session.env,
    stateDir,
    relay: { url: localRelay.url, createSocket: sockets.host },
    log: (line) => {
      logs.push(line);
      if (line.startsWith("relay: connected")) connected.resolve();
    },
  });
  await connected.promise;
  const { link, code } = await pairOffer(localRelay.url);
  const record = await lookupPairSlot({ relayUrl: localRelay.url, code, fetch: fetchFrom });
  if (record === undefined) throw new Error("the relay has no host on the code's slot");
  paired = { hostId: record.hostId, noiseStaticPub: record.noiseStaticPub, lookedUp: link.noiseStaticPub };
  const pairing = await HcConnection.open(await dial(phone, { code }));
  pairing.close();
}, 120_000);

afterAll(async () => {
  if (logs.length > 0) console.log(`host log:\n${logs.join("\n")}`);
  await host?.stop();
  await hc?.dispose();
  await relay?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("web-style client -> relay -> doriface-host uplink -> hc, end to end encrypted", () => {
  test("the typed code's slot lookup names the host the pairing link names, and CPace paired the device", () => {
    expect(paired.noiseStaticPub).toEqual(paired.lookedUp);
    expect(logs).toContain('paired device "relay e2e"');
  });

  test("hello and terminal.list replies are byte-identical to a direct hc connect", async () => {
    const { session } = started();
    const link = await dial(phone);
    const reader = readerOf(link);
    link.send(HELLO);
    const helloViaRelay = await reader.line();
    link.send(rpcFrame(1, "terminal.list"));
    const listViaRelay = await reader.frame();
    link.close();

    const direct = session.connect();
    await direct.write(HELLO);
    const helloDirect = await direct.reader.line();
    await direct.write(rpcFrame(1, "terminal.list"));
    const listDirect = await direct.reader.frame();
    direct.end();
    await direct.exited;

    expect(JSON.parse(decoder.decode(helloViaRelay)).result.framed).toBe(true);
    expect(helloViaRelay).toEqual(helloDirect);
    expect(listViaRelay).toEqual(listDirect);
  }, 30_000);

  test("the client SDK runs server.status and terminal.list through the relay", async () => {
    const connection = await HcConnection.open(await dial(phone));
    const [status, terminals] = await Promise.all([connection.call("server.status"), connection.call("terminal.list")]);
    connection.close();
    expect(typeof status).toBe("object");
    expect(Array.isArray(field(terminals, "terminals"))).toBe(true);
  }, 30_000);

  test("typing 'echo doriface-ok' round-trips while the relay forwards only ciphertext", async () => {
    const link = await dial(phone);
    const reader = readerOf(link);
    let channel = -1;
    let screen = "";
    const onTerminal = (frame: ParsedFrame): void => {
      if (frame.channel === channel) screen += decoder.decode(frame.payload, { stream: true });
    };
    const printedOk = (): boolean => screen.split(/\r?\n/).some((line) => line.trim() === "doriface-ok");
    link.send(HELLO);
    await reader.line();
    link.send(rpc(2, "terminal.run", { argv: ["/bin/sh"], cwd: scratch, env: { PS1: "$ ", HOME: scratch } }));
    const address = field(await replyTo(reader, 2, onTerminal), "address");
    if (typeof address !== "string") throw new Error("terminal.run returned no address");
    link.send(rpc(3, "terminal.attach", { terminal: address, cols: 100, rows: 30 }));
    const attached = field(await replyTo(reader, 3, onTerminal), "channel");
    if (typeof attached !== "number") throw new Error("terminal.attach returned no channel");
    channel = attached;
    link.send(input(channel, "echo doriface-ok\r"));
    await drainUntil(reader, printedOk, onTerminal);
    link.send(rpc(4, "terminal.kill", { terminal: address }));
    expect(field(await replyTo(reader, 4, onTerminal), "state")).toBe("finished");
    link.close();

    const observed = readFileSync(captureFile).toString("latin1");
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.includes("doriface-ok")).toBe(false);
    expect(observed.includes("echo")).toBe(false);
  }, 30_000);

  test("a device the host never paired is refused with 4401 through the relay", async () => {
    const error = await dial(generateX25519()).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error instanceof SecureLinkError && error.code).toBe(CloseCode.UnknownDevice);
  }, 30_000);
});
