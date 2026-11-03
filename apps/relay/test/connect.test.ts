import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { fingerprintOf, generateHostIdentity, generateX25519 } from "@doriface/crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnownHosts } from "../../host/src/state/known-hosts.ts";
import { HELLO, rpcFrame } from "../../host/src/testing/hc-session.ts";
import { runConnect } from "./support/connect-cli.ts";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { within } from "./support/watch.ts";

const decoder = new TextDecoder();
/** A refusal must end the process well inside hc's 20 s dial deadline, never by it. */
const REFUSAL_MS = 5_000;
const phone = generateX25519();
const scratch = mkdtempSync(join(tmpdir(), "connect-"));
const deviceState = join(scratch, "device");
let relayed: RelayedHost | undefined;

function host(): RelayedHost {
  if (relayed === undefined) throw new Error("setup failed");
  return relayed;
}

beforeAll(async () => {
  relayed = await startRelayedHost("doriface-relay-connect");
  await relayed.pair(phone, "phone");
}, 120_000);

afterAll(async () => {
  await relayed?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("doriface-host connect: stdin and stdout piped to the host's hc connect through the relay", () => {
  test("a pairing link pairs once, then the hostId alone reaches hc, byte for byte like a direct hc connect", async () => {
    const { relayUrl, hostId, session } = host();
    const link = await host().pairingLink();
    const pairing = runConnect(deviceState, relayUrl, link, "--name", "device", "sh -c 'exec herdr-core connect'");
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

  test("a typed code pairs with CPace through the relay once the host's fingerprint is confirmed", async () => {
    const code = await host().pairingCode();
    const other = join(scratch, "other");
    const fingerprint = fingerprintOf(host().hostKey).split(" ").slice(0, 4).join(" ");
    const run = runConnect(other, host().relayUrl, code, "--name", "typed", "--fingerprint", fingerprint);
    await run.write(HELLO);
    expect(JSON.parse(decoder.decode(await within(run.reader.line(), "hello"))).result.framed).toBe(true);
    run.end();
    expect(await within(run.exited, "exit")).toBe(0);
  }, 60_000);

  test.each([
    ["no fingerprint", [], "--fingerprint"],
    ["a fingerprint that does not match", ["--fingerprint", "0000 0000 0000 0000"], "does not match"],
    ["too short a fingerprint", ["--fingerprint", "3FA9"], "at least the first 4 groups"],
  ])(
    "a typed code with %s is refused before any pairing",
    async (_case, extra, says) => {
      const before = host().logs.filter((line) => line.startsWith("paired device")).length;
      const run = runConnect(join(scratch, "unconfirmed"), host().relayUrl, await host().pairingCode(), ...extra);
      expect(await within(run.exited, "the refusal", REFUSAL_MS)).toBe(1);
      expect((await run.stderr()).trim().split("\n").at(-1)).toContain(says);
      expect(host().logs.filter((line) => line.startsWith("paired device")).length).toBe(before);
    },
    30_000,
  );

  test("the shell line hc appends to a --via command is taken and ignored", async () => {
    const line =
      "sh -c 'p=$(command -v herdr-core) || p=$HOME/.local/bin/herdr-core; HC_SESSION=other exec \"$p\" connect'";
    const run = runConnect(deviceState, host().relayUrl, host().hostId, line);
    await run.write(HELLO);
    const own = await host().connect(phone);
    own.close();
    expect(JSON.parse(decoder.decode(await within(run.reader.line(), "hello"))).result.core.id).toBe(own.hello.core.id);
    run.end();
    expect(await within(run.exited, "exit")).toBe(0);
  }, 30_000);

  test("a paired host that is not on the relay (4404) fails within a few seconds, exit 1", async () => {
    const offline = join(scratch, "offline");
    const absent = generateHostIdentity();
    new KnownHosts(offline).add({ hostId: absent.hostId, hostKey: absent.noise.publicKey, relayUrl: host().relayUrl });
    const run = runConnect(offline, host().relayUrl, absent.hostId);
    expect(await within(run.exited, "the refusal", REFUSAL_MS)).toBe(1);
    expect((await run.stderr()).trim().split("\n").at(-1)).toMatch(/is not connected to the relay: .*\(4404\)$/);
  }, 30_000);

  test("a typed code no host is pairing with (the relay's lookup answers 404) fails within a few seconds, exit 1", async () => {
    const run = runConnect(join(scratch, "nocode"), host().relayUrl, "ZZZZ-ZZZZ");
    expect(await within(run.exited, "the refusal", REFUSAL_MS)).toBe(1);
    expect((await run.stderr()).trim().split("\n").at(-1)).toContain("no host is pairing with this code");
  }, 30_000);

  test("a pinned key that is not the live host's is refused with 4400 before any byte reaches hc", async () => {
    const wrongKey = join(scratch, "wrong-key");
    new KnownHosts(wrongKey).add({
      hostId: host().hostId,
      hostKey: generateX25519().publicKey,
      relayUrl: host().relayUrl,
    });
    const run = runConnect(wrongKey, host().relayUrl, host().hostId);
    await run.write(HELLO);
    expect(await within(run.exited, "the refusal", REFUSAL_MS)).toBe(1);
    expect((await run.stderr()).trim().split("\n").at(-1)).toMatch(/its key may not match .*\(4400\)$/);
    const leftover = await run.reader.line().then(
      () => "a line",
      (error: unknown) => String(error),
    );
    expect(leftover).toContain("stream ended with 0 unparsed bytes");
  }, 30_000);

  test("a host this machine never paired fails fast with one clear last line and exit 1", async () => {
    const run = runConnect(join(scratch, "stranger"), host().relayUrl, host().hostId);
    expect(await within(run.exited, "the refusal", REFUSAL_MS)).toBe(1);
    const lines = (await run.stderr()).trim().split("\n");
    expect(lines.at(-1)).toContain("has not paired with host");
  }, 30_000);

  test("after a revoke, a fresh pairing link pairs again and hello answers", async () => {
    const again = join(scratch, "again");
    const first = runConnect(again, host().relayUrl, await host().pairingLink(), "--name", "again");
    first.end();
    expect(await within(first.exited, "the first pairing")).toBe(0);
    await host().revokeAll();
    const repair = runConnect(again, host().relayUrl, await host().pairingLink(), "--name", "again");
    await repair.write(HELLO);
    expect(JSON.parse(decoder.decode(await within(repair.reader.line(), "hello after re-pairing"))).result.framed).toBe(
      true,
    );
    repair.end();
    expect(await within(repair.exited, "exit")).toBe(0);
    const plain = runConnect(again, host().relayUrl, host().hostId);
    await plain.write(HELLO);
    expect(JSON.parse(decoder.decode(await within(plain.reader.line(), "hello by hostId"))).result.framed).toBe(true);
    plain.end();
    expect(await within(plain.exited, "exit")).toBe(0);
  }, 60_000);

  test("a device the host revoked or never stored is told to pair again", async () => {
    const stranger = join(scratch, "forgotten");
    const pair = runConnect(stranger, host().relayUrl, await host().pairingLink(), "--name", "forgotten");
    pair.end();
    expect(await within(pair.exited, "pairing")).toBe(0);
    await host().revokeAll();
    const run = runConnect(stranger, host().relayUrl, host().hostId);
    expect(await within(run.exited, "the refusal", REFUSAL_MS)).toBe(1);
    expect((await run.stderr()).trim().split("\n").at(-1)).toContain("pair it again (4401)");
  }, 60_000);
});
