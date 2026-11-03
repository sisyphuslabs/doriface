import { base64urlEncode, fingerprintOf, generateX25519, type SecureLink } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPairing } from "../e2ee/accept.ts";
import { LiveSessions } from "../e2ee/sessions.ts";
import { deviceIdOf, DeviceStore } from "./devices.ts";
import { PairingStore } from "./pairing.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Just enough of a SecureLink to observe how the registry closes it: closes once and then reports it. */
function fakeSession(remoteStatic: Uint8Array): SecureLink & { readonly closes: (number | undefined)[] } {
  const closes: (number | undefined)[] = [];
  const closeListeners = new Set<(error: Error | undefined) => void>();
  return {
    closes,
    pattern: "IK",
    remoteStatic,
    handshakeHash: new Uint8Array(32),
    peerName: undefined,
    lanUrls: [],
    send() {},
    onData: () => () => {},
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close(code) {
      if (closes.length > 0) return;
      closes.push(code);
      for (const listener of closeListeners) listener(undefined);
    },
  };
}

describe("LiveSessions", () => {
  test("a session whose device was revoked before it registered is closed with 4401", () => {
    const devices = new DeviceStore(dir);
    const key = generateX25519().publicKey;
    const kept = generateX25519().publicKey;
    devices.add(key, "phone");
    devices.add(kept, "laptop");
    const sessions = new LiveSessions(devices, () => {});
    devices.revoke(devices.list()[0]?.clientStaticPub ?? "");
    const revoked = fakeSession(key);
    const live = fakeSession(kept);
    sessions.add(revoked);
    sessions.add(live);
    expect([revoked.closes, live.closes]).toEqual([[4401], []]);
  });

  test("an unreadable devices file closes every session instead of keeping them", () => {
    const devices = new DeviceStore(dir);
    const key = generateX25519().publicKey;
    devices.add(key, "phone");
    const sessions = new LiveSessions(devices, () => {});
    const live = fakeSession(key);
    sessions.add(live);
    writeFileSync(join(dir, "devices.json"), "{ not json");
    sessions.closeRevoked();
    expect(live.closes).toEqual([4401]);
  });
});

/** A pid that is no longer running: a child that already exited. */
function deadPid(): number {
  const child = Bun.spawnSync(["sh", "-c", "echo $$"], { stdout: "pipe" });
  return Number(child.stdout.toString().trim());
}

describe("state lock", () => {
  test("a writer holding the lock makes an add or a revoke wait and then give up", () => {
    const devices = new DeviceStore(dir, { lockTimeoutMs: 50 });
    devices.add(generateX25519().publicKey, "phone");
    writeFileSync(join(dir, "state.lock"), String(process.ppid));
    expect(() => devices.revoke(devices.list()[0]?.clientStaticPub ?? "")).toThrow("locked");
    expect(() => devices.add(generateX25519().publicKey, "laptop")).toThrow("locked");
    expect(devices.list()).toHaveLength(1);
  });

  test("a lock left by a dead process is broken", () => {
    const devices = new DeviceStore(dir, { lockTimeoutMs: 50 });
    devices.add(generateX25519().publicKey, "phone");
    writeFileSync(join(dir, "state.lock"), String(deadPid()));
    expect(devices.revoke(devices.list()[0]?.clientStaticPub ?? "")).toHaveLength(1);
    expect(existsSync(join(dir, "state.lock"))).toBe(false);
  });
});

describe("pairing consumption", () => {
  test("the code is burned before the device is stored, so a failed store never reopens it", () => {
    const pairing = new PairingStore(dir);
    pairing.offer();
    const claim = pairing.claim();
    if (claim === undefined) throw new Error("no claim");
    mkdirSync(join(dir, "devices.json"));
    expect(admitPairing(claim, new DeviceStore(dir), generateX25519().publicKey, "phone").ok).toBe(false);
    expect(pairing.claim()).toBeUndefined();
    expect(existsSync(join(dir, "pairing.json"))).toBe(false);
  });

  test("only the first confirmed handshake with a code is admitted", () => {
    const pairing = new PairingStore(dir);
    const devices = new DeviceStore(dir);
    pairing.offer();
    const first = pairing.claim();
    const second = pairing.claim();
    if (first === undefined || second === undefined) throw new Error("claims refused");
    expect(admitPairing(first, devices, generateX25519().publicKey, "a")).toEqual({ ok: true });
    expect(admitPairing(second, devices, generateX25519().publicKey, "b")).toMatchObject({ ok: false, code: 4401 });
    expect(devices.list().map((device) => device.name)).toEqual(["a"]);
  });

  test("a failed attempt settles nothing; the code ends at expiry", () => {
    const pairing = new PairingStore(dir);
    const offer = pairing.offer(0);
    expect(pairing.claim(1)).toBeDefined();
    expect(pairing.claim(1)).toBeDefined();
    expect(pairing.read()?.code).toBe(offer.code);
    expect(pairing.claim(offer.expiresAt)).toBeUndefined();
    expect(existsSync(join(dir, "pairing.json"))).toBe(false);
  });

  test("a pairing confirmed after the code expired is refused and the offer removed", () => {
    const pairing = new PairingStore(dir);
    const offer = pairing.offer(0);
    const claim = pairing.claim(1);
    if (claim === undefined) throw new Error("no claim");
    expect(claim.complete(offer.expiresAt)).toBe(false);
    expect(existsSync(join(dir, "pairing.json"))).toBe(false);
  });

  test("settling an old claim leaves a newer offer alone", () => {
    const pairing = new PairingStore(dir);
    pairing.offer();
    const claim = pairing.claim();
    if (claim === undefined) throw new Error("no claim");
    const replacement = new PairingStore(dir).offer();
    expect(admitPairing(claim, new DeviceStore(dir), generateX25519().publicKey, "a")).toEqual({ ok: true });
    expect(pairing.read()?.code).toBe(replacement.code);
  });
});

/** Two keys whose short ids collide: a birthday search over the 32-bit id space (about 2^16 draws). */
function collidingKeys(): readonly [Uint8Array, Uint8Array] {
  const seen = new Map<string, Uint8Array>();
  for (let draw = 0; draw < 2_000_000; draw++) {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const id = deviceIdOf({ clientStaticPub: base64urlEncode(key), name: "", pairedAt: "" });
    const earlier = seen.get(id);
    if (earlier !== undefined) return [earlier, key];
    seen.set(id, key);
  }
  throw new Error("no short-id collision in 2,000,000 draws");
}

describe("devices revoke", () => {
  test("a short id shared by two devices is refused; the full fingerprint revokes just one", () => {
    const devices = new DeviceStore(dir);
    const [a, b] = collidingKeys();
    devices.add(a, "a");
    devices.add(b, "b");
    const [first] = devices.list();
    if (first === undefined) throw new Error("no device");
    expect(() => devices.revoke(deviceIdOf(first))).toThrow("matches 2 devices");
    expect(devices.list()).toHaveLength(2);
    expect(devices.revoke(fingerprintOf(a)).map((device) => device.name)).toEqual(["a"]);
    expect(devices.list().map((device) => device.name)).toEqual(["b"]);
  });
});

describe("devices file", () => {
  test("an unknown version is refused rather than rewritten", () => {
    writeFileSync(join(dir, "devices.json"), JSON.stringify({ version: 2, devices: [] }));
    expect(() => new DeviceStore(dir).list()).toThrow("unsupported format");
  });
});
