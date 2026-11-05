import { base64urlDecode, fingerprintOf, generateX25519, type SecureLink, SessionKind } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSessions } from "../e2ee/sessions.ts";
import { legacyStateLock } from "../testing/lock-steps.ts";
import { deviceIdOf, DeviceStore } from "./devices.ts";

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
    kind: SessionKind.Session,
    remoteStatic,
    handshakeHash: new Uint8Array(32),
    peerName: undefined,
    lanUrls: [],
    stream: undefined,
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
    legacyStateLock(dir, String(process.ppid));
    expect(() => devices.revoke(devices.list()[0]?.clientStaticPub ?? "")).toThrow("locked");
    expect(() => devices.add(generateX25519().publicKey, "laptop")).toThrow("locked");
    expect(devices.list()).toHaveLength(1);
  });

  test("a lock left by a dead process is broken", () => {
    const devices = new DeviceStore(dir, { lockTimeoutMs: 50 });
    devices.add(generateX25519().publicKey, "phone");
    legacyStateLock(dir, String(deadPid()));
    expect(devices.revoke(devices.list()[0]?.clientStaticPub ?? "")).toHaveLength(1);
    expect(statSync(join(dir, "state.lock")).isDirectory()).toBe(true);
  });
});

/**
 * Two keys whose short ids collide (both 5ECAF24B), found once by a birthday search over the 32-bit id space: random
 * 32-byte keys until two short ids matched (173,935 draws).
 */
const COLLIDING_KEYS = [
  "L4gSWNJizIlkEirkCUCEyMyQPNKFykojUTfJbsJWAvk",
  "fVwrVhHxu7eAoD3SzL_ze1G-mYOt3EyDqllUB2gONy0",
] as const;
const shortIdOf = (clientStaticPub: string): string => deviceIdOf({ clientStaticPub, name: "", pairedAt: "" });

describe("devices revoke", () => {
  test("the colliding fixture keys still share a short id", () => {
    const [a, b] = COLLIDING_KEYS;
    expect(a).not.toBe(b);
    expect(shortIdOf(a)).toBe(shortIdOf(b));
  });

  test("a short id shared by two devices is refused; the full fingerprint revokes just one", () => {
    const devices = new DeviceStore(dir);
    const [a, b] = COLLIDING_KEYS.map(base64urlDecode);
    if (a === undefined || b === undefined) throw new Error("no fixture key");
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
