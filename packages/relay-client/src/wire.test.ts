import { describe, expect, test } from "bun:test";
import {
  authMessage,
  base32,
  decodeMux,
  decodePairSlotReply,
  decodePairSlotRequest,
  encodeClose,
  encodeData,
  encodeOpen,
  encodePairSlotReply,
  encodePairSlotRequest,
  fromBase64Url,
  hostIdOf,
  MuxError,
  MuxType,
  normalizePairCode,
  pairSlotOf,
  PairSlotStatus,
  toBase64Url,
} from "./wire/index.ts";

const encoder = new TextEncoder();

describe("mux frames", () => {
  test("OPEN, DATA and CLOSE round-trip with the sessionId in u32 LE", () => {
    const payload = crypto.getRandomValues(new Uint8Array(300));
    expect([...encodeOpen(0x0102_0304)]).toEqual([1, 4, 3, 2, 1]);
    expect(decodeMux(encodeOpen(0xffff_ffff))).toEqual({ type: MuxType.Open, sessionId: 0xffff_ffff });
    expect(decodeMux(encodeData(7, payload))).toEqual({ type: MuxType.Data, sessionId: 7, payload });
    expect([...encodeClose(9, 4404)]).toEqual([3, 9, 0, 0, 0, 0x34, 0x11]);
    expect(decodeMux(encodeClose(9, 4404))).toEqual({ type: MuxType.Close, sessionId: 9, code: 4404 });
  });

  test("malformed frames are rejected", () => {
    for (const bad of [
      [2, 0, 0],
      [1, 0, 0, 0, 0, 9],
      [3, 0, 0, 0, 0, 1],
      [9, 0, 0, 0, 0],
    ]) {
      expect(() => decodeMux(new Uint8Array(bad))).toThrow(MuxError);
    }
    expect(() => encodeOpen(-1)).toThrow(MuxError);
  });
});

describe("host identity", () => {
  test("base32 matches the RFC 4648 vectors, lower case without padding", () => {
    expect(["", "f", "fo", "foo", "foob", "fooba", "foobar"].map((text) => base32(encoder.encode(text)))).toEqual([
      "",
      "my",
      "mzxq",
      "mzxw6",
      "mzxw6yq",
      "mzxw6ytb",
      "mzxw6ytboi",
    ]);
  });

  test("hostId is base32 of the first 16 bytes of SHA-256(signPub)", async () => {
    const signPub = crypto.getRandomValues(new Uint8Array(32));
    const digest = new Bun.CryptoHasher("sha256").update(signPub).digest();
    expect(await hostIdOf(signPub)).toBe(base32(digest.subarray(0, 16)));
    expect(await hostIdOf(signPub)).toMatch(/^[a-z2-7]{26}$/);
  });

  test("the signed message is context, hostId and challenge concatenated", () => {
    const challenge = new Uint8Array(32).fill(7);
    expect(authMessage("abc", challenge)).toEqual(
      new Uint8Array([...encoder.encode("doriface-relay-v1abc"), ...challenge]),
    );
  });

  test("base64url round-trips and rejects other alphabets", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(fromBase64Url("a+b/")).toBeUndefined();
  });
});

describe("pairing codes and slots", () => {
  test("typed codes normalize like Crockford base32", () => {
    expect(normalizePairCode("ab3k 9xqz")).toBe("AB3K9XQZ");
    expect(normalizePairCode("IlO0-0000")).toBe("11000000");
    expect(normalizePairCode("AB3K9XQ")).toBeUndefined();
    expect(normalizePairCode("AB3K9XQU")).toBeUndefined();
    expect(pairSlotOf("AB3K9XQZ")).toBe("AB3");
  });

  test("PAIR_SLOT requests and replies round-trip", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const request = decodeMux(encodePairSlotRequest("AB3", key));
    expect(request.type).toBe(MuxType.PairSlot);
    expect(request.type === MuxType.PairSlot && decodePairSlotRequest(request.payload)).toEqual({
      slot: "AB3",
      noiseStaticPub: key,
    });
    const reply = decodeMux(encodePairSlotReply("AB3", PairSlotStatus.Taken));
    expect(reply.type === MuxType.PairSlot && decodePairSlotReply(reply.payload)).toEqual({ slot: "AB3", status: 409 });
    expect(() => encodePairSlotRequest("AB", key)).toThrow(RangeError);
    expect(decodePairSlotRequest(new Uint8Array(10))).toBeUndefined();
  });
});
