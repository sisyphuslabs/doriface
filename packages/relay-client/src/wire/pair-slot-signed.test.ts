import { describe, expect, test } from "bun:test";
import { MUX_HEADER_BYTES } from "./mux.ts";
import {
  decodePairSlotRequest,
  encodePairSlotRequest,
  PAIR_SLOT_STATEMENT_PREFIX,
  pairSlotStatement,
} from "./pair-slot.ts";

const noise = new Uint8Array(32).map((_, i) => i + 1);
const signature = new Uint8Array(64).map((_, i) => 255 - i);
const payload = (frame: Uint8Array): Uint8Array => frame.subarray(MUX_HEADER_BYTES);

describe("PAIR_SLOT, both forms (#22, contract v1.9)", () => {
  test("the unsigned form is 35 bytes and decodes with no signature", () => {
    const frame = payload(encodePairSlotRequest("AB3", noise));
    expect(frame.byteLength).toBe(35);
    const decoded = decodePairSlotRequest(frame);
    expect(decoded?.slot).toBe("AB3");
    expect(decoded?.noiseStaticPub).toEqual(noise);
    expect(decoded?.signed).toBeUndefined();
  });

  test("the signed form is 107 bytes and carries the expiry and signature through", () => {
    const expiresAt = 1_793_800_000_123;
    const frame = payload(encodePairSlotRequest("AB3", noise, { expiresAt, signature }));
    expect(frame.byteLength).toBe(107);
    expect(new DataView(frame.buffer, frame.byteOffset).getBigUint64(35)).toBe(BigInt(expiresAt));
    const decoded = decodePairSlotRequest(frame);
    expect(decoded?.noiseStaticPub).toEqual(noise);
    expect(decoded?.signed).toEqual({ expiresAt, signature });
  });

  test("any other length is refused", () => {
    const signed = payload(encodePairSlotRequest("AB3", noise, { expiresAt: 1, signature }));
    for (const length of [34, 36, 42, 43, 106, 108]) {
      const bytes = new Uint8Array(length);
      bytes.set(signed.subarray(0, Math.min(length, signed.byteLength)));
      expect(decodePairSlotRequest(bytes)).toBeUndefined();
    }
  });

  test("a signed form whose expiry is above Number.MAX_SAFE_INTEGER is refused", () => {
    const frame = payload(
      encodePairSlotRequest("AB3", noise, { expiresAt: Number.MAX_SAFE_INTEGER, signature }),
    ).slice();
    expect(decodePairSlotRequest(frame)?.signed?.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
    new DataView(frame.buffer).setBigUint64(35, BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expect(decodePairSlotRequest(frame)).toBeUndefined();
  });

  test("the encoder refuses a short signature or an unsafe expiry", () => {
    expect(() => encodePairSlotRequest("AB3", noise, { expiresAt: 1, signature: new Uint8Array(63) })).toThrow(
      RangeError,
    );
    expect(() => encodePairSlotRequest("AB3", noise, { expiresAt: 2 ** 53, signature })).toThrow(RangeError);
    expect(() => encodePairSlotRequest("AB3", noise, { expiresAt: -1, signature })).toThrow(RangeError);
  });
});

describe("pairSlotStatement", () => {
  test("is the domain prefix, the slot, the Noise key and the expiry as u64 big-endian, nothing else", () => {
    const statement = pairSlotStatement("AB3", noise, 0x0102030405);
    const prefix = new TextEncoder().encode(PAIR_SLOT_STATEMENT_PREFIX);
    expect(statement.byteLength).toBe(prefix.byteLength + 3 + 32 + 8);
    expect(statement.subarray(0, prefix.byteLength)).toEqual(prefix);
    expect(new TextDecoder().decode(statement.subarray(prefix.byteLength, prefix.byteLength + 3))).toBe("AB3");
    expect(statement.subarray(prefix.byteLength + 3, prefix.byteLength + 35)).toEqual(noise);
    expect(Array.from(statement.subarray(prefix.byteLength + 35))).toEqual([0, 0, 0, 1, 2, 3, 4, 5]);
  });

  test("differs for a different slot, Noise key or expiry", () => {
    const base = pairSlotStatement("AB3", noise, 1000);
    expect(pairSlotStatement("AB4", noise, 1000)).not.toEqual(base);
    expect(
      pairSlotStatement(
        "AB3",
        noise.map((b) => b ^ 1),
        1000,
      ),
    ).not.toEqual(base);
    expect(pairSlotStatement("AB3", noise, 1001)).not.toEqual(base);
  });
});
