import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELLO, rpcFrame } from "../../host/src/testing/hc-session.ts";
import { runConnect } from "./support/connect-cli.ts";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { within } from "./support/watch.ts";

const decoder = new TextDecoder();
const scratch = mkdtempSync(join(tmpdir(), "connect-"));
const deviceState = join(scratch, "device");
let relayed: RelayedHost | undefined;

function host(): RelayedHost {
  if (relayed === undefined) throw new Error("setup failed");
  return relayed;
}

beforeAll(async () => {
  relayed = await startRelayedHost("doriface-relay-connect");
}, 120_000);

afterAll(async () => {
  await relayed?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("doriface-host connect: stdin and stdout piped to the host's hc connect through the relay", () => {
  test("a pairing link pairs once, then the hostId alone reaches hc, byte for byte like a direct hc connect", async () => {
    const { relayUrl, hostId, session } = host();
    const pairing = runConnect(deviceState, relayUrl, await host().pairingLink(), "sh -c 'exec herdr-core connect'");
    await pairing.write(HELLO);
    const pairedHello = await within(pairing.reader.line(), "hello over the pairing run");
    pairing.end();
    expect(await within(pairing.exited, "the pairing run exiting")).toBe(0);
    expect(await pairing.stderr()).toContain(`doriface-host connect ${hostId}`);
    expect(JSON.parse(decoder.decode(pairedHello)).result.framed).toBe(true);

    const run = runConnect(deviceState, relayUrl, hostId);
    await run.write(HELLO);
    const hello = await within(run.reader.line(), "hello");
    await run.write(rpcFrame(1, "terminal.list"));
    const list = await within(run.reader.frame(), "terminal.list");
    run.end();
    expect(await within(run.exited, "exit after stdin ends")).toBe(0);

    const direct = session.connect();
    await direct.write(HELLO);
    const helloDirect = await direct.reader.line();
    await direct.write(rpcFrame(1, "terminal.list"));
    const listDirect = await direct.reader.frame();
    direct.end();
    await direct.exited;
    expect(hello).toEqual(helloDirect);
    expect(list).toEqual(listDirect);
  }, 60_000);

  test("SIGTERM ends a live pipe with exit 0", async () => {
    const run = runConnect(deviceState, host().relayUrl, host().hostId);
    await run.write(HELLO);
    await within(run.reader.line(), "hello");
    run.kill("SIGTERM");
    expect(await within(run.exited, "exit after SIGTERM")).toBe(0);
  }, 30_000);

  test("a typed code pairs with CPace through the relay", async () => {
    const code = await host().pairingCode();
    const other = join(scratch, "other");
    const run = runConnect(other, host().relayUrl, code);
    await run.write(HELLO);
    expect(JSON.parse(decoder.decode(await within(run.reader.line(), "hello"))).result.framed).toBe(true);
    run.end();
    expect(await within(run.exited, "exit")).toBe(0);
  }, 60_000);

  test("a host this machine never paired fails fast with one clear last line and exit 1", async () => {
    const run = runConnect(join(scratch, "stranger"), host().relayUrl, host().hostId);
    expect(await within(run.exited, "the refusal")).toBe(1);
    const lines = (await run.stderr()).trim().split("\n");
    expect(lines.at(-1)).toContain("has not paired with host");
  }, 30_000);

  test("a device the host revoked or never stored is told to pair again", async () => {
    const stranger = join(scratch, "forgotten");
    const pair = runConnect(stranger, host().relayUrl, await host().pairingLink());
    pair.end();
    expect(await within(pair.exited, "pairing")).toBe(0);
    await host().revokeAll();
    const run = runConnect(stranger, host().relayUrl, host().hostId);
    expect(await within(run.exited, "the refusal")).toBe(1);
    expect((await run.stderr()).trim().split("\n").at(-1)).toContain("pair it again");
  }, 60_000);
});
