import { bridge, HcPipe } from "@doriface/host";
import {
  connectRelayClient,
  ed25519Signer,
  generateSigningKey,
  Uplink,
  type WebSocketLink,
} from "@doriface/relay-client";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ByteReader } from "../../host/src/testing/byte-reader.ts";
import { createHcSession, HELLO, type HcSession, rpcFrame } from "../../host/src/testing/hc-session.ts";
import { capturingSockets } from "./support/capture.ts";
import { drainUntil, field, input, type ParsedFrame, replyTo, rpc } from "./support/hc-frames.ts";
import { socketFrom, testIp } from "./support/probe.ts";
import { ENCRYPTED } from "./support/record-layer.ts";
import { type LocalRelay, startLocalRelay } from "./support/relay-dev.ts";

const decoder = new TextDecoder();
const scratch = mkdtempSync(join(tmpdir(), "relay-e2e-"));
const captureFile = join(scratch, "relay-observed.bin");
const logs: string[] = [];
let relay: LocalRelay;
let session: HcSession;
let uplink: Uplink;
let client: WebSocketLink;
let reader: ByteReader;

beforeAll(async () => {
  relay = await startLocalRelay();
  session = createHcSession("doriface-relay-e2e");
  const ip = testIp();
  const sockets = capturingSockets(captureFile, socketFrom(ip));
  const answered = Promise.withResolvers<void>();
  uplink = await Uplink.start({
    relayUrl: relay.url,
    signer: ed25519Signer(generateSigningKey()),
    createSocket: sockets.host,
    onState: (state) => {
      if (state.state === "answered") answered.resolve();
    },
    onSession: (link) => {
      const pipe = new HcPipe({
        hc: session.hc,
        session: session.name,
        env: session.env,
        log: (line) => logs.push(line),
      });
      void bridge(link, pipe, (error) => logs.push(`bridge: ${String(error)}`));
    },
  });
  await answered.promise;
  client = await connectRelayClient({ relayUrl: relay.url, hostId: uplink.hostId, createSocket: sockets.client });
  reader = new ByteReader();
  client.onData((bytes) => reader.push(bytes));
  client.onClose(() => reader.end());
}, 120_000);

afterAll(async () => {
  client.close();
  uplink.stop();
  await session.dispose();
  await relay.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("client -> relay -> host uplink -> hc", () => {
  test("hello and terminal.list replies are byte-identical to a direct hc connect", async () => {
    client.send(HELLO);
    const helloViaRelay = await reader.line();
    client.send(rpcFrame(1, "terminal.list"));
    const listViaRelay = await reader.frame();

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
    console.log(
      `via relay, byte-identical: hello ${helloViaRelay.byteLength} B, terminal.list ${listViaRelay.byteLength} B`,
    );
  }, 30_000);

  test("typing 'echo doriface-ok' into an attached shell round-trips; the relay sees ciphertext only with crypto", async () => {
    let channel = -1;
    let screen = "";
    const onTerminal = (frame: ParsedFrame): void => {
      if (frame.channel === channel) screen += decoder.decode(frame.payload, { stream: true });
    };
    const printedOk = (): boolean => screen.split(/\r?\n/).some((line) => line.trim() === "doriface-ok");

    client.send(rpc(2, "terminal.run", { argv: ["/bin/sh"], cwd: scratch, env: { PS1: "$ ", HOME: scratch } }));
    const address = field(await replyTo(reader, 2, onTerminal), "address");
    if (typeof address !== "string") throw new Error("terminal.run returned no address");
    client.send(rpc(3, "terminal.attach", { terminal: address, cols: 100, rows: 30 }));
    const attached = field(await replyTo(reader, 3, onTerminal), "channel");
    if (typeof attached !== "number") throw new Error("terminal.attach returned no channel");
    channel = attached;
    client.send(input(channel, "echo doriface-ok\r"));
    await drainUntil(reader, printedOk, onTerminal);
    client.send(rpc(4, "terminal.kill", { terminal: address }));
    expect(field(await replyTo(reader, 4, onTerminal), "state")).toBe("finished");

    // LEAD RE-RUN after @doriface/crypto merges: with ENCRYPTED true this must find no 'doriface-ok' in the capture.
    const observed = readFileSync(captureFile).toString("latin1");
    console.log(`relay observed ${observed.length} payload bytes; encrypted=${ENCRYPTED}`);
    expect(observed.includes("doriface-ok")).toBe(!ENCRYPTED);
  }, 30_000);
});
