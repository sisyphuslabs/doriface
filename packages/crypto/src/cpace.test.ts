import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cpaceGenerator,
  cpaceInitiate,
  cpaceIsk,
  cpaceRespond,
  generatorString,
  lvCat,
  prependLen,
  sampleScalar,
  scalarMultVfy,
} from "./cpace.ts";

const file = Bun.file(join(import.meta.dir, "..", "vectors", "cpace-ristretto255-sha512.json"));
const vectors: unknown = await file.json();

/** A string field of the vector file, by path; throws so a missing vector can never pass silently. */
function field(...path: readonly string[]): string {
  let value: unknown = vectors;
  for (const key of path) {
    if (typeof value !== "object" || value === null || !(key in value)) throw new Error(`vector ${path.join(".")}`);
    value = Object.entries(value).find(([name]) => name === key)?.[1];
  }
  if (typeof value !== "string") throw new Error(`vector ${path.join(".")} is not a string`);
  return value;
}
const hex = (...path: readonly string[]): Uint8Array => Uint8Array.fromHex(field(...path).toLowerCase());
const scalarOf = (bytes: Uint8Array): bigint => bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n);
const range = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i);
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const prs = hex("protocol", "PRS");
const ci = hex("protocol", "CI");
const sid = hex("protocol", "sid");
const ya = scalarOf(hex("protocol", "ya"));
const yb = scalarOf(hex("protocol", "yb"));

describe("CPACE-RISTR255-SHA512 against draft-irtf-cfrg-cpace-21", () => {
  test("the vectors are draft 21's", () => {
    expect(field("source")).toBe("draft-irtf-cfrg-cpace-21");
  });

  test("A.1.2 prepend_len and A.1.4 lv_cat", () => {
    expect(prependLen(new Uint8Array(0)).toHex()).toBe(field("prependLen", "prepend_len(b'')").toLowerCase());
    expect(prependLen(ascii("1234")).toHex()).toBe(field("prependLen", "prepend_len(b'1234')").toLowerCase());
    expect(prependLen(range(127)).toHex()).toBe(field("prependLen", "prepend_len(bytes(range(127)))").toLowerCase());
    expect(prependLen(range(128)).toHex()).toBe(field("prependLen", "prepend_len(bytes(range(128)))").toLowerCase());
    const joined = lvCat(ascii("1234"), ascii("5"), new Uint8Array(0), ascii("678"));
    expect(joined.toHex()).toBe(field("lvCat", "lv_cat(b'1234',b'5',b'',b'678')").toLowerCase());
  });

  test("B.3.1 generator string, its hash and the generator", () => {
    const generated = generatorString(prs, ci, sid);
    expect(generated.toHex()).toBe(field("generator", "generator_string(G.DSI,PRS,CI,sid,H.s_in_bytes)").toLowerCase());
    expect(generated.byteLength).toBe(170);
    expect(sha512(generated).toHex()).toBe(field("generator", "hash result").toLowerCase());
    expect(cpaceGenerator(prs, ci, sid).toBytes().toHex()).toBe(field("protocol", "g").toLowerCase());
  });

  test("B.3.2 to B.3.5: Ya, Yb, K from both sides and ISK_IR", () => {
    const share = (scalar: bigint): Uint8Array => cpaceGenerator(prs, ci, sid).multiply(scalar).toBytes();
    expect(share(ya).toHex()).toBe(field("protocol", "Ya").toLowerCase());
    expect(share(yb).toHex()).toBe(field("protocol", "Yb").toLowerCase());
    const k = field("protocol", "K").toLowerCase();
    expect(scalarMultVfy(ya, hex("protocol", "Yb")).toHex()).toBe(k);
    expect(scalarMultVfy(yb, hex("protocol", "Ya")).toHex()).toBe(k);
    const isk = cpaceIsk(
      sid,
      hex("protocol", "K"),
      hex("protocol", "Ya"),
      ascii("ADa"),
      hex("protocol", "Yb"),
      ascii("ADb"),
    );
    expect(isk.toHex()).toBe(field("protocol", "ISK_IR").toLowerCase());
  });

  test("B.3.10 scalar_mult_vfy with valid inputs", () => {
    const result = scalarMultVfy(scalarOf(hex("scalarMultVfy", "Valid", "s")), hex("scalarMultVfy", "Valid", "X"));
    expect(result.toHex()).toBe(field("scalarMultVfy", "Valid", "G.scalar_mult_vfy(s,X)").toLowerCase());
  });

  test.each(["Invalid Y1", "Invalid Y2"])("B.3.11 %s aborts, and the responder refuses it as a share", (name) => {
    const s = scalarOf(hex("scalarMultVfy", "Valid", "s"));
    expect(() => scalarMultVfy(s, hex("scalarMultVfy", name))).toThrow();
    expect(() => cpaceRespond({ prs, ci, sid }, hex("scalarMultVfy", name))).toThrow();
  });
});

describe("CPace runs", () => {
  test("the initiator and responder agree on the ISK, with the draft's shares for the draft's scalars", () => {
    const initiator = cpaceInitiate({ prs, ci, sid }, { scalar: ya });
    const responder = cpaceRespond({ prs, ci, sid }, initiator.share, { scalar: yb });
    expect([initiator.share.toHex(), responder.share.toHex()]).toEqual([
      field("protocol", "Ya").toLowerCase(),
      field("protocol", "Yb").toLowerCase(),
    ]);
    expect(initiator.finish(responder.share)).toEqual(responder.isk);
  });

  test("another password gives another ISK", () => {
    const initiator = cpaceInitiate({ prs, ci, sid });
    const responder = cpaceRespond({ prs: ascii("Passwore"), ci, sid }, initiator.share);
    expect(initiator.finish(responder.share)).not.toEqual(responder.isk);
  });
});

describe("sampleScalar", () => {
  test("a zero draw is drawn again", () => {
    const draws = [new Uint8Array(32), Uint8Array.of(5, ...new Uint8Array(31))];
    const scalar = sampleScalar((bytes) => {
      bytes.set(draws.shift() ?? new Uint8Array(32));
      return bytes;
    });
    expect(scalar).toBe(5n);
    expect(draws).toHaveLength(0);
  });

  test("the bits above 252 are cleared", () => {
    const scalar = sampleScalar((bytes) => bytes.fill(0xff));
    expect(scalar).toBe(2n ** 252n - 1n);
  });
});
