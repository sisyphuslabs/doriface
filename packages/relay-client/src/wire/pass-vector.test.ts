import { describe, expect, test } from "bun:test";
import { proofMessage } from "./pass.ts";

/**
 * The proof layout as fixed bytes (contract v1.6, "Relay passes"). The expected hex was written from the contract's
 * layout, not produced by this code; the relay's own suite pins the same bytes, so the two sides cannot drift.
 */
const VECTOR = {
  relayOrigin: "wss://r.example",
  role: "client",
  target: "a".repeat(26),
  pass: Uint8Array.from({ length: 58 }, (_, index) => index),
  signPub: new Uint8Array(32).fill(0xaa),
  ts: 1800000123456,
  nonce: new Uint8Array(16).fill(0xbb),
} as const;
const MESSAGE_HEX =
  "646f7269666163652d72656c61792d70726f6f662d76317773733a2f2f722e6578616d706c6500636c69656e74006161616161616161616161616161" +
  "6161616161616161616161610001000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d" +
  "2e2f30313233343536373839aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000001a3185e3240bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("the proof's signed bytes (fixed vector)", () => {
  test("context, origin, role, target and body are laid out exactly as the contract says", () => {
    const { body, message } = proofMessage(VECTOR);
    expect(hex(message)).toBe(MESSAGE_HEX);
    expect(hex(body)).toBe(MESSAGE_HEX.slice(-body.byteLength * 2));
  });

  test("the role is signed: a host proof and a client proof over the same inputs differ", () => {
    expect(hex(proofMessage({ ...VECTOR, role: "host" }).message)).not.toBe(MESSAGE_HEX);
  });
});
