import { generateX25519, type SecureLink, SessionKind } from "@doriface/crypto";
import { memoryLinkPair, type MemoryEnd } from "@doriface/crypto/testing";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceStore } from "../state/devices.ts";
import { MeshStore } from "../state/mesh.ts";
import { REVOKED } from "./accept.ts";
import { LiveSessions } from "./sessions.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stores() {
  const dir = mkdtempSync(join(tmpdir(), "dh-sessions-"));
  dirs.push(dir);
  const devices = new DeviceStore(dir);
  return { devices, sessions: new LiveSessions(devices, () => {}, new MeshStore(dir, { log: () => {} })) };
}

const session = (end: MemoryEnd, remoteStatic: Uint8Array): SecureLink =>
  Object.assign(end, {
    kind: SessionKind.Session,
    remoteStatic,
    handshakeHash: new Uint8Array(32),
    peerName: undefined,
    lanUrls: [],
    stream: undefined,
  });

describe("registering a live session", () => {
  test("a session no store authorizes is closed at once, and add says so", () => {
    const [end] = memoryLinkPair();
    expect(stores().sessions.add(session(end, generateX25519().publicKey))).toBe(false);
    expect(end.closeCode).toBe(REVOKED.code);
  });

  test("a paired device's session stays open, and add says so", () => {
    const { devices, sessions } = stores();
    const key = generateX25519().publicKey;
    devices.add(key, "phone");
    const [end] = memoryLinkPair();
    expect(sessions.add(session(end, key))).toBe(true);
    expect(end.closeCode).toBeUndefined();
  });
});
