import { generateX25519 } from "@doriface/crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnownHosts, loadDeviceKey } from "./known-hosts.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dh-known-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("this machine's device key", () => {
  test("is generated once, kept owner-only, and loads the same afterwards", () => {
    const first = loadDeviceKey(dir);
    expect(statSync(join(dir, "device-key.json")).mode & 0o777).toBe(0o600);
    expect(loadDeviceKey(dir)).toEqual(first);
  });

  test("a key file others can read is refused, not used", () => {
    loadDeviceKey(dir);
    chmodSync(join(dir, "device-key.json"), 0o644);
    expect(() => loadDeviceKey(dir)).toThrow("readable by other users");
  });
});

describe("KnownHosts", () => {
  test("a paired host survives a new store on the same dir, and unknown hosts are undefined", () => {
    const hostKey = generateX25519().publicKey;
    const host = { hostId: "a".repeat(26), hostKey, relayUrl: "wss://relay.example" };
    new KnownHosts(dir).add(host);
    const reloaded = new KnownHosts(dir);
    expect(reloaded.get(host.hostId)).toEqual(host);
    expect(reloaded.get("b".repeat(26))).toBeUndefined();
    expect(statSync(join(dir, "known-hosts.json")).mode & 0o777).toBe(0o600);
  });

  test("pairing the same host again replaces its record", () => {
    const store = new KnownHosts(dir);
    const hostId = "c".repeat(26);
    store.add({ hostId, hostKey: generateX25519().publicKey, relayUrl: "wss://one.example" });
    store.add({ hostId, hostKey: generateX25519().publicKey, relayUrl: "wss://two.example" });
    expect(new KnownHosts(dir).get(hostId)?.relayUrl).toBe("wss://two.example");
  });
});
