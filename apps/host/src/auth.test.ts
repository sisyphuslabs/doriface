import { describe, expect, test } from "bun:test";
import { assertValidToken, checkHandshake, generateToken } from "./auth.ts";
import { isLoopbackHost, parseListen } from "./listen.ts";

const token = generateToken();

describe("checkHandshake", () => {
  test.each([
    [`doriface.v1, doriface.token.${token}`, { ok: true }],
    [`doriface.v1,doriface.token.${token}`, { ok: true }],
    [`doriface.v1, doriface.token.${token}x`, { ok: false, status: 401 }],
    ["doriface.v1", { ok: false, status: 401 }],
    [undefined, { ok: false, status: 401 }],
    [`doriface.token.${token}, doriface.v1`, { ok: false, status: 400 }],
  ])("%p", (header, expected) => {
    expect(checkHandshake(header, token)).toMatchObject(expected);
  });
});

describe("tokens", () => {
  test("generated tokens are 43 base64url characters and pass validation", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(assertValidToken(token)).toBe(token);
  });

  test.each(["short", "has space in it and is long enough", "a,b-ccccccccccccccccccccc"])("rejects %p", (bad) => {
    expect(() => assertValidToken(bad)).toThrow();
  });
});

describe("listen address", () => {
  test.each([
    ["127.0.0.1:7766", "127.0.0.1", 7766],
    ["[::1]:0", "::1", 0],
    [":9000", "127.0.0.1", 9000],
    ["localhost:1", "localhost", 1],
  ])("parses %p", (value, hostname, port) => {
    expect(parseListen(value)).toEqual({ hostname, port });
  });

  test.each(["7766", "host:99999", "[::1]", "a:b"])("rejects %p", (value) => {
    expect(() => parseListen(value)).toThrow();
  });

  test.each([
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["::1", true],
    ["localhost", true],
    ["0.0.0.0", false],
    ["::", false],
    ["192.168.1.2", false],
    ["127.0.0.1.example.com", false],
  ])("%p is loopback: %p", (hostname, loopback) => {
    expect(isLoopbackHost(hostname)).toBe(loopback);
  });
});
