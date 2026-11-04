import { base64urlEncode, generateX25519, type SecureLink, SessionKind } from "@doriface/crypto";
import { memoryLinkPair, type MemoryEnd } from "@doriface/crypto/testing";
import { hashOf, signRecord } from "@doriface/mesh";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVOKED } from "../e2ee/accept.ts";
import { LiveSessions } from "../e2ee/sessions.ts";
import { DeviceStore } from "../state/devices.ts";
import { cardFor, machine, MeshFixture, noiseOf, signPubOf } from "../testing/mesh-history.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A mesh where X, never having acked B's admission, admits T with B's Noise key on an older head: both admissions pass
 * type_ok (neither sees the other), so the view holds two members with one Noise key (#90 case (a)).
 */
function concurrentTwin() {
  const dir = mkdtempSync(join(tmpdir(), "dh-twin-key-"));
  dirs.push(dir);
  const [a, x, b] = [machine("alpha"), machine("xray"), machine("beta")];
  const mesh = new MeshFixture(dir, a);
  const admittedX = mesh.admit(a, x);
  mesh.admit(a, b);
  const t = machine("twin");
  const twin = { ...t, identity: { ...t.identity, noise: b.identity.noise } };
  const body = { ...mesh.next(x, "admit", { card: cardFor(twin, mesh.meshId, x) }), prev: [hashOf(admittedX)] };
  const { refused } = mesh.store.merge([signRecord(body, x.identity.sign.secretKey)]);
  if (refused.length > 0) throw new Error(`the twin admit was refused: ${refused[0]?.reason}`);
  return { dir, mesh, a, b, twin };
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

describe("#90: a Noise key that another signing key names authorizes nobody", () => {
  test("two current members holding one Noise key: neither is authorized by it", () => {
    const { mesh, b, twin } = concurrentTwin();
    const index = mesh.store.authorizeIndex();
    expect([index?.isMember(signPubOf(b)), index?.isMember(signPubOf(twin))]).toEqual([true, true]);
    expect(index?.member(noiseOf(b))).toBeUndefined();
    expect(index?.deviceRefusal(noiseOf(b))).toBe("a Noise key that more than one mesh key names");
  });

  test("(b) a session on a revoked member's key closes after the revoke even with a twin present", () => {
    const { dir, mesh, a, b, twin } = concurrentTwin();
    const sessions = new LiveSessions(new DeviceStore(dir), () => {}, mesh.store);
    const [end] = memoryLinkPair();
    sessions.add(session(end, b.identity.noise.publicKey));
    mesh.revoke(a, b);
    sessions.closeRevoked();
    const index = mesh.store.authorizeIndex();
    expect(index?.isMember(signPubOf(twin))).toBe(true);
    expect(index?.member(noiseOf(b))).toBeUndefined();
    expect(index?.deviceRefusal(noiseOf(b))).toBe("revoked mesh member");
    expect(end.closeCode).toBe(REVOKED.code);
  });

  test("a revoked member re-admitted under its own signing key is authorized by its key again", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-twin-key-"));
    dirs.push(dir);
    const [a, b] = [machine("alpha"), machine("beta")];
    const mesh = new MeshFixture(dir, a);
    mesh.admit(a, b);
    mesh.revoke(a, b);
    expect(mesh.store.authorizeIndex()?.member(noiseOf(b))).toBeUndefined();
    mesh.admit(a, b);
    expect(mesh.store.authorizeIndex()?.member(noiseOf(b))?.signPub).toBe(signPubOf(b));
  });

  test("key rotation moves authorization to the new key, and a rotation back to the member's own old key works", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-twin-key-"));
    dirs.push(dir);
    const [a, b] = [machine("alpha"), machine("beta")];
    const mesh = new MeshFixture(dir, a);
    mesh.admit(a, b);
    const [first, second] = [b.identity.noise, generateX25519()];
    mesh.rekey(b, second);
    const rotated = mesh.store.authorizeIndex();
    expect(rotated?.member(base64urlEncode(second.publicKey))?.signPub).toBe(signPubOf(b));
    expect(rotated?.member(noiseOf(b))).toBeUndefined();
    mesh.rekey(b, first);
    expect(mesh.store.authorizeIndex()?.member(noiseOf(b))?.signPub).toBe(signPubOf(b));
  });
});
