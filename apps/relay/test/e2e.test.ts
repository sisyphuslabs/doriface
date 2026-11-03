import { HcConnection } from "@doriface/client";
import { CloseCode, generateX25519, parsePairingUrl, type SecureLink, SecureLinkError } from "@doriface/crypto";
import { lookupPairSlot } from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ByteReader } from "../../host/src/testing/byte-reader.ts";
import { HELLO, rpcFrame } from "../../host/src/testing/hc-session.ts";
import { capturingSockets } from "./support/capture.ts";
import { drainUntil, field, input, type ParsedFrame, replyTo, rpc } from "./support/hc-frames.ts";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";

const decoder = new TextDecoder();
const scratch = mkdtempSync(join(tmpdir(), "relay-e2e-"));
const captureFile = join(scratch, "relay-observed.bin");
const phone = generateX25519();
let relayed: RelayedHost | undefined;
let paired: { readonly noiseStaticPub: Uint8Array; readonly lookedUp: Uint8Array };

function started(): RelayedHost {
  if (relayed === undefined) throw new Error("the e2e setup did not finish");
  return relayed;
}

const fetchFrom = (target: string): Promise<Response> =>
  fetch(target, { headers: { "cf-connecting-ip": started().ip } });

const dial = (key = phone): Promise<SecureLink> => started().dial(key);

function readerOf(link: SecureLink): ByteReader {
  const reader = new ByteReader();
  link.onData((bytes) => reader.push(bytes));
  link.onClose(() => reader.end());
  return reader;
}

beforeAll(async () => {
  relayed = await startRelayedHost("doriface-relay-e2e", {
    wrapSockets: (base) => capturingSockets(captureFile, base),
  });
  const { url, code } = await relayed.pairingOffer();
  const record = await lookupPairSlot({ relayUrl: relayed.relayUrl, code, fetch: fetchFrom });
  if (record === undefined) throw new Error("the relay has no host on the code's slot");
  paired = { noiseStaticPub: record.noiseStaticPub, lookedUp: parsePairingUrl(url).noiseStaticPub };
  (await HcConnection.open(await relayed.dialPairCode(phone, code, "relay e2e"))).close();
}, 120_000);

afterAll(async () => {
  await relayed?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("web-style client -> relay -> doriface-host uplink -> hc, end to end encrypted", () => {
  test("the typed code's slot lookup names the host the pairing link names, and CPace paired the device", () => {
    expect(paired.noiseStaticPub).toEqual(paired.lookedUp);
    expect(started().logs).toContain('paired device "relay e2e"');
  });

  test("hello and terminal.list replies are byte-identical to a direct hc connect", async () => {
    const { session } = started();
    const link = await dial();
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
    const connection = await HcConnection.open(await dial());
    const [status, terminals] = await Promise.all([connection.call("server.status"), connection.call("terminal.list")]);
    connection.close();
    expect(typeof status).toBe("object");
    expect(Array.isArray(field(terminals, "terminals"))).toBe(true);
  }, 30_000);

  test("typing 'echo doriface-ok' round-trips while the relay forwards only ciphertext", async () => {
    const link = await dial();
    const reader = readerOf(link);
    const { scratch: dir } = started();
    let channel = -1;
    let screen = "";
    const onTerminal = (frame: ParsedFrame): void => {
      if (frame.channel === channel) screen += decoder.decode(frame.payload, { stream: true });
    };
    const printedOk = (): boolean => screen.split(/\r?\n/).some((line) => line.trim() === "doriface-ok");
    link.send(HELLO);
    await reader.line();
    link.send(rpc(2, "terminal.run", { argv: ["/bin/sh"], cwd: dir, env: { PS1: "$ ", HOME: dir } }));
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
