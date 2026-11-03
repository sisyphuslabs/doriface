import { x25519 } from "@noble/curves/ed25519.js";
import { describe, expect, test } from "bun:test";
import { memoryStore } from "../storage/idb.ts";
import { loadDeviceKey } from "./device-key.ts";

describe("loadDeviceKey", () => {
  test("without WebCrypto X25519 it keeps raw bytes and agrees with a noble peer", async () => {
    const storage = memoryStore();
    const key = await loadDeviceKey(storage, null);
    expect(key.kind).toBe("raw");
    const peerPrivate = x25519.utils.randomSecretKey();
    const shared = await key.dh(x25519.getPublicKey(peerPrivate));
    expect(shared).toEqual(x25519.getSharedSecret(peerPrivate, key.publicKey));
    const again = await loadDeviceKey(storage, null);
    expect(again.publicKey).toEqual(key.publicKey);
  });

  test("concurrent first calls share one identity", async () => {
    const storage = memoryStore();
    const [first, second] = await Promise.all([loadDeviceKey(storage, null), loadDeviceKey(storage, null)]);
    expect(second.publicKey).toEqual(first.publicKey);
    expect((await loadDeviceKey(storage, null)).publicKey).toEqual(first.publicKey);
  });

  test("with WebCrypto X25519 the private key is a non-extractable CryptoKey", async () => {
    const storage = memoryStore();
    const key = await loadDeviceKey(storage, crypto.subtle);
    expect(key.kind).toBe("webcrypto");
    const stored = await storage.get("device-key");
    expect(stored).toMatchObject({ kind: "webcrypto" });
    const privateKey: unknown = Reflect.get(Object(stored), "privateKey");
    expect(privateKey instanceof CryptoKey && privateKey.extractable).toBe(false);
    const peerPrivate = x25519.utils.randomSecretKey();
    expect(await key.dh(x25519.getPublicKey(peerPrivate))).toEqual(x25519.getSharedSecret(peerPrivate, key.publicKey));
  });
});
