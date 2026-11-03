import { describe, expect, test } from "bun:test";
import {
  decodeHello,
  decodeReply,
  encodePairingHello,
  encodeReply,
  encodeSessionHello,
  MAX_EARLY_BYTES,
} from "./payloads.ts";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("handshake payloads: one JSON line, then raw stream bytes", () => {
  test("a pairing hello is exactly {v:1,name} and a line feed", () => {
    expect(text(encodePairingHello("  Pixel 9 "))).toBe('{"v":1,"name":"Pixel 9"}\n');
    expect(decodeHello("IKpsk2", encodePairingHello("Pixel 9"))).toEqual({ kind: "pairing", name: "Pixel 9" });
  });

  test("a session hello carries early stream bytes after its line", () => {
    const early = bytes('{"jsonrpc":"2.0","id":0,"method":"hello"}\n');
    const payload = encodeSessionHello(early);
    expect(text(payload)).toBe(`{"v":1}\n${text(early)}`);
    expect(decodeHello("IK", payload)).toEqual({ kind: "session", early });
  });

  test("a reply lists IP-literal LAN URLs", () => {
    const lan = ["ws://192.0.2.10:41237/v1/e2ee", "ws://[2001:db8::1]:7766/v1/e2ee"];
    expect(text(encodeReply(lan))).toBe(`{"v":1,"lan":${JSON.stringify(lan)}}\n`);
    expect(decodeReply(encodeReply(lan))).toEqual(lan);
    expect(decodeReply(encodeReply([]))).toEqual([]);
  });

  test.each([
    ["IKpsk2", '{"v":1,"name":"a"}\nextra'],
    ["IKpsk2", '{"v":1,"name":"a\\u001b[2J"}\n'],
    ["IKpsk2", '{"v":1,"name":"bidi\\u202e"}\n'],
    ["IKpsk2", '{"v":1}\n'],
    ["IKpsk2", `{"v":1,"name":"${"x".repeat(65)}"}\n`],
    ["IK", '{"v":2}\n'],
    ["IK", "[1]\n"],
    ["IK", '{"v":1}'],
    ["IK", `{"v":1,"pad":"${"x".repeat(300)}"}\n`],
    ["IK", `{"v":1}\n${"x".repeat(MAX_EARLY_BYTES + 1)}`],
  ] as const)("%s refuses %p", (pattern, payload) => {
    expect(() => decodeHello(pattern, bytes(payload))).toThrow();
  });

  test("a reply keeps an explicit default port", () => {
    const lan = ["ws://192.0.2.10:80/v1/e2ee"];
    expect(decodeReply(encodeReply(lan))).toEqual(lan);
  });

  test.each([
    ["ws://doriface.local:7766/v1/e2ee"],
    ["wss://192.0.2.10:7766/v1/e2ee"],
    ["ws://192.0.2.10/v1/e2ee"],
    ["ws://192.0.2.10:7766/v1/hc"],
    ["ws://user:pass@192.0.2.10:7766/v1/e2ee"],
    ["ws://192.0.2.10:7766/v1/e2ee?x=1"],
    ["ws://192.0.2.10:7766/v1/e2ee#x"],
    ["ws://192.0.2.10:0/v1/e2ee"],
    ["ws://999.0.2.10:7766/v1/e2ee"],
    ["ws://[fe80::1%25en0]:7766/v1/e2ee"],
  ])("a reply refuses %p", (url) => {
    expect(() => encodeReply([url])).toThrow();
    expect(() => decodeReply(bytes(`{"v":1,"lan":["${url}"]}\n`))).toThrow();
  });

  test("too many early bytes are refused when encoding", () => {
    expect(() => encodeSessionHello(new Uint8Array(MAX_EARLY_BYTES + 1))).toThrow();
  });
});
