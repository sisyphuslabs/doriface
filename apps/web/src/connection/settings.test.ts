import { expect, test } from "bun:test";
import { DEFAULT_RELAY_URL, DEFAULT_SETTINGS, loadSettings, staysOnThisComputer } from "./settings.ts";

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

/** A Storage holding one saved connection, as a browser that once had a custom relay typed in would. */
function saved(value: object): Storage {
  const items = new Map([["doriface.connection", JSON.stringify(value)]]);
  return {
    length: items.size,
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: () => null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, item) => void items.set(key, item),
  };
}

const CUSTOM = { ...DEFAULT_SETTINGS, relayUrl: "wss://relay.custom.invalid", hostId: "h", hostKey: "k" };

test("a release build ignores a saved custom relay address and uses the production relay", () => {
  expect(loadSettings(saved(CUSTOM), { devBuild: false })).toEqual({ ...CUSTOM, relayUrl: DEFAULT_RELAY_URL });
});

test("a dev build keeps a saved custom relay address", () => {
  expect(loadSettings(saved(CUSTOM), { devBuild: true }).relayUrl).toBe("wss://relay.custom.invalid");
});

test("with no localStorage at all, as under bun's test runner, the defaults (#490)", () => {
  expect(Reflect.get(globalThis, "localStorage")).toBeUndefined();
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});
