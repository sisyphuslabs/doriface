import { base64urlDecode, base64urlEncode, concatBytes } from "@doriface/crypto";
import { join } from "node:path";
import { createPrivateJson, ensureStateDir, isRecord, readJson, stringField } from "../state/files.ts";
import type { VapidKey } from "./web-push.ts";

const FILE = "push-vapid.json";
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

async function generate(): Promise<{ readonly d: string; readonly x: string; readonly y: string }> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (jwk.d === undefined || jwk.x === undefined || jwk.y === undefined) throw new Error("P-256 export lacks a part");
  return { d: jwk.d, x: jwk.x, y: jwk.y };
}

function parse(value: unknown): { readonly d: string; readonly x: string; readonly y: string } {
  if (!isRecord(value) || value["version"] !== 1) throw new Error(`${FILE}: unsupported format`);
  return { d: stringField(value, "d", FILE), x: stringField(value, "x", FILE), y: stringField(value, "y", FILE) };
}

/**
 * This host's VAPID key (RFC 8292): made on first use and kept 0600 in the state dir, never anywhere else. Every
 * subscription is bound to its public half, so replacing the file makes each device subscribe again.
 */
export async function loadVapidKey(stateDir: string): Promise<VapidKey> {
  const path = join(ensureStateDir(stateDir), FILE);
  let stored = readJson(path);
  if (stored === undefined) {
    createPrivateJson(path, { version: 1, ...(await generate()) });
    stored = readJson(path);
  }
  const { d, x, y } = parse(stored);
  const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d, x, y }, ECDSA, false, ["sign"]);
  const publicKey = concatBytes(Uint8Array.of(4), base64urlDecode(x), base64urlDecode(y));
  return { privateKey, publicKey: base64urlEncode(publicKey) };
}
