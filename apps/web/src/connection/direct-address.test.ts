import { expect, test } from "bun:test";
import { directDial, parseDirectAddress, type DirectAddress } from "./direct-address.ts";

const usable = (value: string): Extract<DirectAddress, { readonly usable: true }> => {
  const parsed = parseDirectAddress(value);
  if (!parsed.usable) throw new Error(`expected ${value} to be usable: ${parsed.reason}`);
  return parsed;
};

const NORMALISED: readonly { readonly value: string; readonly url: string; readonly loopback: boolean }[] = [
  { value: "192.0.2.10:7767", url: "ws://192.0.2.10:7767/v1/e2ee", loopback: false },
  { value: "ws://192.0.2.10:7767", url: "ws://192.0.2.10:7767/v1/e2ee", loopback: false },
  { value: "ws://192.0.2.10:7767/v1/e2ee", url: "ws://192.0.2.10:7767/v1/e2ee", loopback: false },
  { value: "wss://host.example", url: "wss://host.example/v1/e2ee", loopback: false },
  { value: "wss://host.example/v1/e2ee", url: "wss://host.example/v1/e2ee", loopback: false },
  { value: "  ws://127.0.0.1:7767/  ", url: "ws://127.0.0.1:7767/v1/e2ee", loopback: true },
  { value: "ws://[::1]:7767", url: "ws://[::1]:7767/v1/e2ee", loopback: true },
  { value: "localhost:7767", url: "ws://localhost:7767/v1/e2ee", loopback: true },
];

for (const entry of NORMALISED) {
  test(`a direct address is normalised to the host's session route: ${entry.value}`, () => {
    const parsed = usable(entry.value);
    expect(parsed.url).toBe(entry.url);
    expect(parsed.loopback).toBe(entry.loopback);
  });
}

const REFUSED: readonly { readonly value: string; readonly reason: string }[] = [
  { value: "", reason: "no address is set" },
  { value: "http://192.0.2.10:7767", reason: "only ws:// and wss:// are accepted" },
  { value: "https://host.example", reason: "only ws:// and wss:// are accepted" },
  { value: "ws://user:secret@192.0.2.10:7767", reason: "an address carries no credentials" },
  { value: "ws://192.0.2.10:7767/v1/e2ee?token=abc", reason: "an address carries no query and no fragment" },
  { value: "ws://192.0.2.10:7767/v1/e2ee#x", reason: "an address carries no query and no fragment" },
  { value: "ws://192.0.2.10:7767/v1/hc", reason: "the only path is /v1/e2ee" },
  { value: "ws://192.0.2.10:7767/other", reason: "the only path is /v1/e2ee" },
];

for (const entry of REFUSED) {
  test(`a direct address that names anything else is refused: ${entry.value}`, () => {
    expect(parseDirectAddress(entry.value)).toEqual({ usable: false, reason: entry.reason });
  });
}

test("a secure page dials wss and loopback itself, and refuses plain ws to another machine", () => {
  const secure = { secureContext: true, forwardsPlainWs: false };
  expect(directDial(usable("wss://host.example"), secure)).toEqual({
    kind: "dial",
    url: "wss://host.example/v1/e2ee",
  });
  expect(directDial(usable("127.0.0.1:7767"), secure)).toEqual({ kind: "dial", url: "ws://127.0.0.1:7767/v1/e2ee" });
  expect(directDial(usable("192.0.2.10:7767"), secure)).toEqual({
    kind: "blocked",
    reason: "this page can't open ws:// to another machine; use wss://",
  });
});

test("a dev build's http page dials plain ws itself, and the desktop shell forwards it instead (#449)", () => {
  expect(directDial(usable("192.0.2.10:7767"), { secureContext: false, forwardsPlainWs: false })).toEqual({
    kind: "dial",
    url: "ws://192.0.2.10:7767/v1/e2ee",
  });
  expect(directDial(usable("192.0.2.10:7767"), { secureContext: true, forwardsPlainWs: true })).toEqual({
    kind: "forward",
    url: "ws://192.0.2.10:7767/v1/e2ee",
  });
});
