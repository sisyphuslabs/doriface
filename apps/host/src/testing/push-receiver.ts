// A stand-in browser and push service for tests: it decrypts what the host sent (RFC 8291) and checks its VAPID
// header (RFC 8292). Plain WebCrypto only, so the Playwright specs can use it under Node as well as Bun.

const P256_ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const P256_ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

const own = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const fromB64url = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64url"));

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey("raw", own(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, own(data)));
}

/** What a browser keeps for one subscription: the private half and the auth secret, plus what it hands the app. */
export interface ReceiverKeys {
  readonly privateKey: CryptoKey;
  readonly p256dh: string;
  readonly auth: string;
}

export async function receiverKeys(): Promise<ReceiverKeys> {
  const pair = await crypto.subtle.generateKey(P256_ECDH, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    p256dh: b64url(publicKey),
    auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/** Imports RFC 8291 Appendix A's receiver key from its raw private and public halves. */
export async function receiverKeysFrom(privateKey: string, p256dh: string, auth: string): Promise<ReceiverKeys> {
  const pub = fromB64url(p256dh);
  const jwk = { kty: "EC", crv: "P-256", d: privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) };
  return { privateKey: await crypto.subtle.importKey("jwk", jwk, P256_ECDH, false, ["deriveBits"]), p256dh, auth };
}

/** Decrypts one `aes128gcm` body (a single record) the way a browser does, or throws. */
export async function decryptPushBody(body: Uint8Array, keys: ReceiverKeys): Promise<Uint8Array> {
  const salt = body.subarray(0, 16);
  const idLength = body[20] ?? 0;
  const senderPublic = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const uaPublic = fromB64url(keys.p256dh);
  const peer = await crypto.subtle.importKey("raw", own(senderPublic), P256_ECDH, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, keys.privateKey, 256));
  const prkKey = await hmac(fromB64url(keys.auth), ecdh);
  const ikm = await hmac(prkKey, concat(text("WebPush: info\0"), uaPublic, senderPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, text("Content-Encoding: aes128gcm\0\x01"))).subarray(0, 16);
  const nonce = (await hmac(prk, text("Content-Encoding: nonce\0\x01"))).subarray(0, 12);
  const aes = await crypto.subtle.importKey("raw", own(cek), "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: own(nonce) }, aes, own(sealed)));
  const end = padded.lastIndexOf(2);
  if (end === -1) throw new Error("no last-record delimiter");
  return padded.subarray(0, end);
}

export interface VapidClaims {
  readonly aud: string;
  readonly exp: number;
  readonly sub: string;
}

/** Checks an `Authorization: vapid t=..., k=...` header's ES256 signature against `k`; returns its key and claims. */
export async function verifyVapid(header: string): Promise<{ readonly key: string; readonly claims: VapidClaims }> {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (match === null) throw new Error(`not a vapid header: ${header}`);
  const [, head = "", payload = "", signature = "", key = ""] = match;
  const pub = fromB64url(key);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) };
  const verifier = await crypto.subtle.importKey("jwk", jwk, P256_ECDSA, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifier,
    own(fromB64url(signature)),
    own(text(`${head}.${payload}`)),
  );
  if (!ok) throw new Error("the vapid signature does not verify");
  const claims: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (typeof claims !== "object" || claims === null) throw new Error("vapid claims are not an object");
  const get = (name: string): unknown => Reflect.get(claims, name);
  const aud = get("aud");
  const exp = get("exp");
  const sub = get("sub");
  if (typeof aud !== "string" || typeof exp !== "number" || typeof sub !== "string") throw new Error("vapid claims");
  return { key, claims: { aud, exp, sub } };
}
