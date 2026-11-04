import { expect, test } from "bun:test";
import { DEFAULT_SETTINGS, staysOnThisComputer } from "./settings.ts";

test.each([
  ["ws://127.0.0.1:7766/v1/hc", true],
  ["ws://127.8.0.1:7766/v1/hc", true],
  ["ws://localhost:52011/v1/hc", true],
  ["ws://[::1]:52011/v1/hc", true],
  ["ws://192.168.0.4:7766/v1/hc", false],
  ["ws://studio.lan:7766/v1/hc", false],
  ["ws://127.0.0.1.example.com/v1/hc", false],
  ["not a url", false],
])("a loopback gateway at %s stays on this computer: %p", (loopbackUrl, expected) => {
  expect(staysOnThisComputer({ ...DEFAULT_SETTINGS, mode: "loopback", loopbackUrl })).toBe(expected);
});

test("a relay link never stays on this computer", () => {
  expect(staysOnThisComputer({ ...DEFAULT_SETTINGS, loopbackUrl: "ws://127.0.0.1:7766/v1/hc" })).toBe(false);
});
