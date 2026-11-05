/**
 * The soak's host hands each client a single-use pairing link through workflow artifacts, which anyone can download on
 * a public repository. The link is sealed to a key only that client holds: X25519 with a fresh ephemeral key, HKDF-SHA256,
 * AES-256-GCM. A client publishes only its public key.
 *
 *   bun soak/seal.ts keygen <secret file>               prints the public key (base64url)
 *   bun soak/seal.ts seal <public key> <plaintext file>  prints the sealed JSON
 *   bun soak/seal.ts open <secret file> <sealed file>    prints the plaintext
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { readFileSync, writeFileSync } from "node:fs";

const INFO = new TextEncoder().encode("doriface-soak-link-v1");

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(text.trim(), "base64url"));

async function aesKey(shared: Uint8Array, ephemeral: Uint8Array, recipient: Uint8Array): Promise<CryptoKey> {
  const salt = new Uint8Array([...ephemeral, ...recipient]);
  const raw = new Uint8Array(hkdf(sha256, shared, salt, INFO, 32));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

interface Sealed {
  readonly epk: string;
  readonly iv: string;
  readonly ct: string;
}

export async function seal(recipient: Uint8Array, plaintext: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const ephemeral = x25519.keygen();
  const key = await aesKey(x25519.getSharedSecret(ephemeral.secretKey, recipient), ephemeral.publicKey, recipient);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return { epk: b64(ephemeral.publicKey), iv: b64(iv), ct: b64(ct) };
}

export async function open(secret: Uint8Array, sealed: Sealed): Promise<Uint8Array> {
  const ephemeral = unb64(sealed.epk);
  const key = await aesKey(x25519.getSharedSecret(secret, ephemeral), ephemeral, x25519.getPublicKey(secret));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct)));
}

async function main([command, a, b]: readonly (string | undefined)[]): Promise<void> {
  if (command === "keygen" && a !== undefined) {
    const { secretKey, publicKey } = x25519.keygen();
    writeFileSync(a, b64(secretKey), { mode: 0o600 });
    process.stdout.write(`${b64(publicKey)}\n`);
  } else if (command === "seal" && a !== undefined && b !== undefined) {
    process.stdout.write(`${JSON.stringify(await seal(unb64(a), new Uint8Array(readFileSync(b))))}\n`);
  } else if (command === "open" && a !== undefined && b !== undefined) {
    const sealed = JSON.parse(readFileSync(b, "utf8")) as Sealed;
    process.stdout.write(await open(unb64(readFileSync(a, "utf8")), sealed));
  } else {
    throw new Error(
      "usage: seal.ts keygen <secret file> | seal <public key> <file> | open <secret file> <sealed file>",
    );
  }
}

if (import.meta.main) await main(process.argv.slice(2));
