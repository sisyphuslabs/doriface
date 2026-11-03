import {
  CloseCode,
  encodePairingHello,
  generateX25519,
  type KeyPair,
  pairingPsk,
  parsePairingUrl,
  SecureLinkError,
} from "@doriface/crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { type Host, startHost } from "./host.ts";
import { openE2eeClient, type E2eeClient } from "./testing/e2ee-client.ts";
import { createHcSession, HELLO, type HcSession, rpcFrame } from "./testing/hc-session.ts";

const CLI = join(import.meta.dir, "cli.ts");
const device = generateX25519();
const stateDir = mkdtempSync(join(tmpdir(), "dh-e2ee-"));
let session: HcSession;
let host: Host;

async function cli(...args: string[]): Promise<{ readonly code: number; readonly stdout: string }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args, "--state-dir", stateDir], { stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
}

function endpoint() {
  const e2ee = host.e2ee;
  if (e2ee === undefined) throw new Error("the host has no e2ee endpoint");
  return e2ee;
}

let pairing: ReturnType<typeof parsePairingUrl>;

const dial = (staticKey: KeyPair, extra: { readonly psk?: Uint8Array; readonly payload?: Uint8Array } = {}) =>
  openE2eeClient(endpoint().url, {
    hostId: pairing.hostId,
    staticKey,
    remoteStatic: pairing.noiseStaticPub,
    ...extra,
  });

async function refusal(attempt: Promise<E2eeClient>): Promise<number | undefined> {
  const error = await attempt.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof SecureLinkError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.code;
}

beforeAll(async () => {
  session = createHcSession("doriface-e2ee-test");
  host = await startHost({
    listen: { hostname: "127.0.0.1", port: 0 },
    token: generateToken(),
    hc: session.hc,
    session: session.name,
    env: session.env,
    stateDir,
    lanListen: { hostname: "127.0.0.1", port: 0 },
    log: () => {},
  });
  const paired = await cli("pair", "--no-qr", "--web-origin", "https://web.example");
  const url = paired.stdout.split("\n").find((line) => line.startsWith("https://web.example/pair#"));
  if (paired.code !== 0 || url === undefined) throw new Error(`pair failed: ${paired.stdout}`);
  pairing = parsePairingUrl(url);
});

afterAll(async () => {
  await host.stop();
  await session.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("/v1/e2ee against a real hc", () => {
  test("pair prints a link for this host and keeps its state owner-only", () => {
    expect(pairing.hostId).toBe(endpoint().hostId);
    expect(pairing.relayUrl).toBe("https://relay-doriface.omo.dev");
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(stateDir, "host-keys.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, "pairing.json")).mode & 0o777).toBe(0o600);
  });

  test("a device pairs once over IKpsk2; the code then refuses anyone else with 4401", async () => {
    const psk = pairingPsk(pairing.code);
    const first = await dial(device, { psk, payload: encodePairingHello("test phone") });
    expect(first.link.pattern).toBe("IKpsk2");
    first.link.close();
    const listed = await cli("devices", "list");
    expect(listed.stdout).toMatch(/^[a-z2-7]{8} {2}\S+ {2}test phone\n$/);
    const second = dial(generateX25519(), { psk, payload: encodePairingHello("intruder") });
    expect(await refusal(second)).toBe(CloseCode.UnknownDevice);
    expect(statSync(join(stateDir, "devices.json")).mode & 0o777).toBe(0o600);
  });

  test("an IK reconnect carries hello and terminal.list byte-identical to a direct hc connect", async () => {
    const client = await dial(device);
    expect(client.link.pattern).toBe("IK");
    client.link.send(HELLO);
    const helloViaE2ee = await client.reader.line();
    client.link.send(rpcFrame(1, "terminal.list"));
    const listViaE2ee = await client.reader.frame();

    const direct = session.connect();
    await direct.write(HELLO);
    const helloDirect = await direct.reader.line();
    await direct.write(rpcFrame(1, "terminal.list"));
    const listDirect = await direct.reader.frame();
    direct.end();
    await direct.exited;

    expect(JSON.parse(new TextDecoder().decode(helloViaE2ee)).result.framed).toBe(true);
    expect(helloViaE2ee).toEqual(helloDirect);
    expect(listViaE2ee).toEqual(listDirect);
    console.log(
      `byte-identical over e2ee: hello ${helloViaE2ee.byteLength} B, terminal.list ${listViaE2ee.byteLength} B`,
    );
    client.link.close();
  });

  test("an unpaired key is refused with 4401", async () => {
    expect(await refusal(dial(generateX25519()))).toBe(CloseCode.UnknownDevice);
  });

  test("the LAN listener serves /v1/e2ee but never the plaintext /v1/hc", async () => {
    const lanUrl = endpoint().lanUrl;
    if (lanUrl === undefined) throw new Error("no LAN listener");
    const plaintext = await fetch(lanUrl.replace("ws://", "http://").replace("/v1/e2ee", "/v1/hc"));
    expect(plaintext.status).toBe(404);
    const client = await openE2eeClient(lanUrl, {
      hostId: pairing.hostId,
      staticKey: device,
      remoteStatic: pairing.noiseStaticPub,
    });
    client.link.send(HELLO);
    expect(JSON.parse(new TextDecoder().decode(await client.reader.line())).result.framed).toBe(true);
    client.link.close();
  });

  test("devices revoke closes the live session with 4401 and refuses the next one", async () => {
    const live = await dial(device);
    live.link.send(HELLO);
    await live.reader.line();
    const id = (await cli("devices", "list")).stdout.slice(0, 8);
    const revoked = await cli("devices", "revoke", id);
    expect(revoked).toEqual({ code: 0, stdout: `revoked ${id}  test phone\n` });
    expect(await live.closed).toBe(CloseCode.UnknownDevice);
    expect(await refusal(dial(device))).toBe(CloseCode.UnknownDevice);
  });
});
