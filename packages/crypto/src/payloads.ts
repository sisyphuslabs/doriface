import { concatBytes, utf8 } from "./encoding.ts";

/** Handshake payloads are one JSON line (at most 256 bytes with its LF), then raw stream bytes where allowed. */
const MAX_LINE = 256;
const MAX_DEVICE_NAME = 64;
/** IK message 1 may carry the first stream bytes, normally the hc `hello` line. */
export const MAX_EARLY_BYTES = 4096;
const MAX_LAN_URLS = 8;
const LF = 0x0a;

export class PayloadError extends Error {
  override readonly name = "PayloadError";
}

/** Control, format and line-separator characters could rewrite a terminal or a UI line that shows the name. */
const UNSAFE_NAME_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function deviceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > MAX_DEVICE_NAME) {
    throw new PayloadError(`a device name is 1-${MAX_DEVICE_NAME} characters`);
  }
  if (UNSAFE_NAME_CHARACTER.test(trimmed)) throw new PayloadError("a device name cannot contain control characters");
  return trimmed;
}

const line = (value: object): Uint8Array => utf8(`${JSON.stringify({ v: 1, ...value })}\n`);

/** Splits off the leading JSON line, checks `v == 1`, and returns its fields and the bytes after the LF. */
function splitLine(payload: Uint8Array): {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly rest: Uint8Array;
} {
  const end = payload.subarray(0, MAX_LINE).indexOf(LF);
  if (end === -1) throw new PayloadError(`a handshake payload starts with a JSON line of at most ${MAX_LINE} bytes`);
  let fields: unknown;
  try {
    fields = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(0, end)));
  } catch (error) {
    throw new PayloadError("the handshake payload line is not UTF-8 JSON", { cause: error });
  }
  if (typeof fields !== "object" || fields === null || Array.isArray(fields) || !("v" in fields) || fields.v !== 1) {
    throw new PayloadError("the handshake payload line must be a JSON object with v = 1");
  }
  return { fields: Object.fromEntries(Object.entries(fields)), rest: payload.subarray(end + 1) };
}

/** Pairing message 1: `{"v":1,"name":"<device name>"}\n` and nothing after it. */
export const encodePairingHello = (name: string): Uint8Array => line({ name: deviceName(name) });

/** IK message 1: `{"v":1}\n` followed by up to {@link MAX_EARLY_BYTES} early stream bytes. */
export function encodeSessionHello(early: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (early.byteLength > MAX_EARLY_BYTES) throw new PayloadError(`at most ${MAX_EARLY_BYTES} early bytes`);
  return concatBytes(line({}), early);
}

export type Hello =
  | { readonly kind: "pairing"; readonly name: string }
  | { readonly kind: "session"; readonly early: Uint8Array };

export function decodeHello(pattern: "IK" | "IKpsk2", payload: Uint8Array): Hello {
  const { fields, rest } = splitLine(payload);
  if (pattern === "IK") {
    if (rest.byteLength > MAX_EARLY_BYTES) throw new PayloadError(`at most ${MAX_EARLY_BYTES} early bytes`);
    return { kind: "session", early: rest.slice() };
  }
  const name = fields["name"];
  if (typeof name !== "string") throw new PayloadError('a pairing hello carries {"name": string}');
  if (rest.byteLength > 0) throw new PayloadError("a pairing hello carries nothing after its line");
  return { kind: "pairing", name: deviceName(name) };
}

/** Accepts `ws://<IP literal>:<port>/v1/e2ee` only: LAN addresses are literals, never hostnames to resolve. */
function lanUrl(value: unknown): string {
  if (typeof value !== "string" || !URL.canParse(value)) throw new PayloadError("a LAN URL is a ws:// URL");
  const url = new URL(value);
  const literal = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.startsWith("[");
  if (url.protocol !== "ws:" || !literal || url.port === "" || url.pathname !== "/v1/e2ee") {
    throw new PayloadError(`not a LAN e2ee URL: ${value}`);
  }
  return url.toString();
}

/** Message 2: `{"v":1,"lan":[…]}\n` with at most 8 IP-literal LAN URLs, and nothing after it. */
export function encodeReply(lanUrls: readonly string[]): Uint8Array {
  if (lanUrls.length > MAX_LAN_URLS) throw new PayloadError(`at most ${MAX_LAN_URLS} LAN URLs`);
  const encoded = line({ lan: lanUrls.map(lanUrl) });
  if (encoded.byteLength > MAX_LINE) throw new PayloadError(`the reply line exceeds ${MAX_LINE} bytes`);
  return encoded;
}

export function decodeReply(payload: Uint8Array): readonly string[] {
  const { fields, rest } = splitLine(payload);
  const lan = fields["lan"];
  if (rest.byteLength > 0 || !Array.isArray(lan) || lan.length > MAX_LAN_URLS) {
    throw new PayloadError('a reply is {"v":1,"lan":[…]} and nothing after it');
  }
  return lan.map(lanUrl);
}
