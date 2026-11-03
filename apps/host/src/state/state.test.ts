import { generateX25519, type SecureLink } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPairing } from "../e2ee/accept.ts";
import { LiveSessions } from "../e2ee/sessions.ts";
import { DeviceStore } from "./devices.ts";
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
    helloPayload: new Uint8Array(0),
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
});

/** A pid that is no longer running: a child that already exited. */
function deadPid(): number {
  const child = Bun.spawnSync(["sh", "-c", "echo $$"], { stdout: "pipe" });
  return Number(child.stdout.toString().trim());
}

describe("state lock", () => {
  test("a writer holding the lock makes a revoke wait and then give up", () => {
    const devices = new DeviceStore(dir, { lockTimeoutMs: 50 });
    devices.add(generateX25519().publicKey, "phone");
    writeFileSync(join(dir, "state.lock"), String(process.ppid));
    expect(() => devices.revoke(devices.list()[0]?.clientStaticPub ?? "")).toThrow("locked");
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

describe("devices file", () => {
  test("an unknown version is refused rather than rewritten", () => {
    writeFileSync(join(dir, "devices.json"), JSON.stringify({ version: 2, devices: [] }));
    expect(() => new DeviceStore(dir).list()).toThrow("unsupported format");
  });
});
