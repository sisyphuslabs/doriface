import { createHash, timingSafeEqual } from "node:crypto";

export const SUBPROTOCOL = "doriface.v1";
const TOKEN_PREFIX = "doriface.token.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,}$/;

/** 32 random bytes, base64url: valid inside a Sec-WebSocket-Protocol entry. */
export function generateToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function assertValidToken(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("the token must be at least 22 base64url characters [A-Za-z0-9_-]");
  return token;
}

export type HandshakeVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 400 | 401; readonly reason: string };

/**
 * Checks `Sec-WebSocket-Protocol: doriface.v1, doriface.token.<token>`. Bun answers with the first offered
 * subprotocol, so `doriface.v1` has to lead for the echo to be `doriface.v1`.
 */
export function checkHandshake(header: string | undefined, token: string): HandshakeVerdict {
  const offered = (header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const presented = offered.find((entry) => entry.startsWith(TOKEN_PREFIX))?.slice(TOKEN_PREFIX.length);
  if (presented === undefined || !sameSecret(presented, token)) {
    return { ok: false, status: 401, reason: "missing or wrong doriface token" };
  }
  if (offered[0] !== SUBPROTOCOL)
    return { ok: false, status: 400, reason: `the first subprotocol must be ${SUBPROTOCOL}` };
  return { ok: true };
}

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

function sameSecret(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}
