import { describe, expect, test } from "bun:test";
import { base32Decode, base32Encode, base64urlDecode, base64urlEncode, utf8 } from "./encoding.ts";

describe("base32 (RFC 4648 section 10, lowercase, no padding)", () => {
  test.each([
    ["", ""],
    ["f", "my"],
    ["fo", "mzxq"],
    ["foo", "mzxw6"],
    ["foob", "mzxw6yq"],
    ["fooba", "mzxw6ytb"],
    ["foobar", "mzxw6ytboi"],
  ])("%p <-> %p", (plain, encoded) => {
    expect(base32Encode(utf8(plain))).toBe(encoded);
    expect(base32Decode(encoded)).toEqual(utf8(plain));
    expect(base32Decode(encoded.toUpperCase())).toEqual(utf8(plain));
  });

  test.each(["mzxw6ytboi=", "m1", "mz", "a"])("rejects %p", (bad) => {
    expect(() => base32Decode(bad)).toThrow();
  });
});

describe("base64url", () => {
  test("round-trips every byte value without padding", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = base64urlEncode(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64urlDecode(text)).toEqual(bytes);
  });

  test.each(["a", "ab+c", "ab=="])("rejects %p", (bad) => {
    expect(() => base64urlDecode(bad)).toThrow();
  });
});
