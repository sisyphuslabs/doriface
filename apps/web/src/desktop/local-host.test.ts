import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type ConnectionSettings } from "../connection/settings.ts";
import { desktopBridge } from "./bridge.ts";
import { bootConnection, useThisComputer } from "./local-host.ts";

function target(settings: ConnectionSettings) {
  const calls: string[] = [];
  const state = {
    settings,
    update(next: ConnectionSettings) {
      state.settings = next;
      calls.push("update");
    },
    start() {
      calls.push("start");
    },
    restoring() {
      calls.push("restoring");
    },
  };
  return { state, calls };
}

const bridge = (url: string) => ({ startLocalHost: async () => ({ url, token: "t0k" }) });

describe("desktop local host", () => {
  test("Use this computer saves loopback settings from the started host", async () => {
    const { state } = target(DEFAULT_SETTINGS);
    await useThisComputer(bridge("ws://127.0.0.1:52011/v1/hc"), state);
    expect(state.settings).toMatchObject({ mode: "loopback", loopbackUrl: "ws://127.0.0.1:52011/v1/hc", token: "t0k" });
  });

  test("boot restarts the local host for a saved loopback connection", async () => {
    const { state, calls } = target({
      ...DEFAULT_SETTINGS,
      mode: "loopback",
      loopbackUrl: "ws://127.0.0.1:1/v1/hc",
      token: "old",
    });
    await bootConnection(bridge("ws://127.0.0.1:52012/v1/hc"), state);
    expect(calls).toEqual(["restoring", "update"]);
    expect(state.settings.loopbackUrl).toBe("ws://127.0.0.1:52012/v1/hc");
  });

  test("a connection chosen while the host is starting is not overwritten", async () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      mode: "loopback" as const,
      loopbackUrl: "ws://127.0.0.1:1/v1/hc",
      token: "old",
    };
    const { state, calls } = target(saved);
    const answer = Promise.withResolvers<{ url: string; token: string }>();
    const booting = bootConnection({ startLocalHost: () => answer.promise }, state);
    state.update({ ...DEFAULT_SETTINGS, mode: "relay" });
    answer.resolve({ url: "ws://127.0.0.1:2/v1/hc", token: "new" });
    await booting;
    expect(state.settings.mode).toBe("relay");
    expect(calls).toEqual(["restoring", "update"]);
  });

  test("boot only starts the connection outside the desktop app or in relay mode", async () => {
    const outside = target({ ...DEFAULT_SETTINGS, mode: "loopback" });
    await bootConnection(null, outside.state);
    const relay = target(DEFAULT_SETTINGS);
    await bootConnection(bridge("ws://x"), relay.state);
    expect([outside.calls, relay.calls]).toEqual([["start"], ["start"]]);
  });

  test("the bridge is read only when it has startLocalHost, and its answer is checked", async () => {
    expect(desktopBridge({})).toBeNull();
    expect(desktopBridge({ doriface: { version: "1" } })).toBeNull();
    const bad = desktopBridge({ doriface: { startLocalHost: async () => ({ url: 1 }) } });
    await expect(bad?.startLocalHost() ?? Promise.resolve()).rejects.toThrow("no local host address");
  });
});
