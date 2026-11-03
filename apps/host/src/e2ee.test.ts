import {
  CloseCode,
  generateX25519,
  type KeyPair,
  formatPairingCode,
  pairingPsk,
  rawStaticKey,
  pairingSlotOf,
  parsePairingUrl,
  SecureLinkError,
} from "@doriface/crypto";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { type Host, startHost } from "./host.ts";
import { openE2eeClient, type E2eeClient } from "./testing/e2ee-client.ts";
import { createHcSession, HELLO, type HcSession, rpcFrame } from "./testing/hc-session.ts";

const CLI = join(import.meta.dir, "cli.ts");
/** These tests spawn the CLI; a cold transpiler cache alone can take most of bun's 5 s default. */
setDefaultTimeout(30_000);
const device = generateX25519();
const stateDir = mkdtempSync(join(tmpdir(), "dh-e2ee-"));
let session: HcSession;
let host: Host;
const logWaiters = new Set<(line: string) => void>();
/** Resolves with the first host log line matching `pattern` from now on; subscribe before the action. */
function nextLog(pattern: RegExp): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const timer = setTimeout(() => reject(new Error(`no log line matching ${pattern}`)), 5000);
  const waiter = (line: string): void => {
    if (!pattern.test(line)) return;
    clearTimeout(timer);
    logWaiters.delete(waiter);
    resolve(line);
  };
  logWaiters.add(waiter);
  return promise;
}
/** A relay stand-in: the first slot collides (409), later ones register. */
const slots: { readonly asked: string[]; readonly keys: Uint8Array[]; readonly released: string[] } = {
  asked: [],
  keys: [],
  released: [],
};
const releaseWaiters = new Map<string, () => void>();
/** Resolves when the host releases `slot`; subscribe before the action that should release it. */
function released(slot: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(() => reject(new Error(`slot ${slot} was not released`)), 5000);
  releaseWaiters.set(slot, () => {
    clearTimeout(timer);
    resolve();
  });
  return promise;
}
const registrar = {
  register: (slot: string, noiseStaticPub: Uint8Array) => {
    slots.asked.push(slot);
    slots.keys.push(noiseStaticPub);
    return Promise.resolve(slots.asked.length === 1 ? ("collision" as const) : ("registered" as const));
  },
  release: (slot: string) => {
    slots.released.push(slot);
    releaseWaiters.get(slot)?.();
  },
};

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

function lanEndpoint(): string {
  const [lanUrl] = endpoint().lanUrls;
  if (lanUrl === undefined) throw new Error("no LAN listener");
  return lanUrl;
}

let pairing: ReturnType<typeof parsePairingUrl>;
let pairOutput = "";

async function pair(): Promise<ReturnType<typeof parsePairingUrl>> {
  const paired = await cli("pair", "--no-qr", "--web-origin", "https://web.example");
  const url = paired.stdout.split("\n").find((line) => line.startsWith("https://web.example/pair#"));
  if (paired.code !== 0 || url === undefined) throw new Error(`pair failed: ${paired.stdout}`);
  pairOutput = paired.stdout;
  return parsePairingUrl(url);
}

const dial = (staticKey: KeyPair, pairingWith?: { readonly psk: Uint8Array; readonly name: string }) =>
  openE2eeClient(endpoint().url, {
    hostId: pairing.hostId,
    staticKey: rawStaticKey(staticKey),
    remoteStatic: pairing.noiseStaticPub,
    pairing: pairingWith,
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
    pairingSlots: registrar,
    log: (line) => {
      for (const waiter of logWaiters) waiter(line);
    },
  });
  pairing = await pair();
});

afterAll(async () => {
  await host.stop();
  await session.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("/v1/e2ee against a real hc", () => {
  test("pair prints a link for this host and keeps its state owner-only", () => {
    expect(pairing.hostId).toBe(endpoint().hostId);
    expect(pairing.relayUrl).toBe("wss://relay-doriface.omo.dev");
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(stateDir, "host-keys.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, "pairing.json")).mode & 0o777).toBe(0o600);
    expect(pairOutput).toContain(`\nfingerprint ${endpoint().fingerprint}\n`);
  });

  test("a relay slot collision draws a new code before pair prints it", () => {
    expect(slots.asked).toHaveLength(2);
    expect(slots.asked[1]).toBe(pairingSlotOf(pairing.code));
    expect(slots.keys.every((key) => key.toHex() === pairing.noiseStaticPub.toHex())).toBe(true);
    expect(pairOutput).toContain(`\ncode        ${formatPairingCode(pairing.code)}\n`);
  });

  test("fingerprint prints the host fingerprint in ten groups of four", async () => {
    const printed = await cli("fingerprint");
    expect(printed).toEqual({ code: 0, stdout: `${endpoint().fingerprint}\n` });
    expect(printed.stdout).toMatch(/^([0-9A-F]{4} ){9}[0-9A-F]{4}\n$/);
  });

  test("a device pairs once over IKpsk2; the code then refuses anyone else with 4401", async () => {
    const psk = pairingPsk(pairing.code);
    const used = released(pairingSlotOf(pairing.code));
    const stored = nextLog(/^paired device "test phone"$/);
    const first = await dial(device, { psk, name: "test phone" });
    expect(first.link.pattern).toBe("IKpsk2");
    expect(first.link.lanUrls).toEqual([lanEndpoint()]);
    first.link.close();
    await stored;
    const listed = await cli("devices", "list");
    expect(listed.stdout).toMatch(/^[0-9A-F]{8} {2}\S+ {2}test phone\n$/);
    await used;
    expect(slots.released).toEqual([pairingSlotOf(pairing.code)]);
    const second = dial(generateX25519(), { psk, name: "intruder" });
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

  test("wrong guesses leave the code usable; the right one pairs and releases the relay slot", async () => {
    const offer = await pair();
    const used = released(pairingSlotOf(offer.code));
    const stored = nextLog(/^paired device "second phone"$/);
    const wrong = pairingPsk(`${offer.code.slice(0, 7)}${offer.code.endsWith("0") ? "1" : "0"}`);
    const guesses = [1, 2, 3, 4].map((attempt) =>
      refusal(dial(generateX25519(), { psk: wrong, name: `guesser ${attempt}` })),
    );
    expect(await Promise.all(guesses)).toEqual([4, 4, 4, 4].map(() => CloseCode.CryptoFailure));
    const right = await dial(generateX25519(), { psk: pairingPsk(offer.code), name: "second phone" });
    expect(right.link.pattern).toBe("IKpsk2");
    right.link.close();
    await Promise.all([used, stored]);
    expect(existsSync(join(stateDir, "pairing.json"))).toBe(false);
  });

  test("an unpaired key is refused with 4401", async () => {
    expect(await refusal(dial(generateX25519()))).toBe(CloseCode.UnknownDevice);
  });

  test("the LAN listener serves /v1/e2ee but never the plaintext /v1/hc", async () => {
    const lanUrl = lanEndpoint();
    const plaintext = await fetch(lanUrl.replace("ws://", "http://").replace("/v1/e2ee", "/v1/hc"));
    expect(plaintext.status).toBe(404);
    const client = await openE2eeClient(lanUrl, {
      hostId: pairing.hostId,
      staticKey: rawStaticKey(device),
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
