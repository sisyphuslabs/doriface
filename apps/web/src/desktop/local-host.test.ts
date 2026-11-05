import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type ConnectionSettings } from "../connection/settings.ts";
import {
  closeDesktopWindow,
  desktopBridge,
  desktopHcChooser,
  HostStartError,
  type HostStartFailure,
  onDesktopNavigate,
  setDesktopBackground,
  zoomDesktopWindow,
} from "./bridge.ts";
import { bootConnection, startFailure, startThisComputer } from "./local-host.ts";

const noop = (): void => undefined;

function target(settings: ConnectionSettings) {
  const calls: string[] = [];
  const failures: HostStartFailure[] = [];
  const state = {
    settings,
    hostStartFailed(failure: HostStartFailure) {
      failures.push(failure);
      calls.push("hostStartFailed");
    },
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
  return { state, calls, failures };
}

const bridge = (url: string) => ({ startLocalHost: async () => ({ url, token: "t0k" }) });

describe("desktop local host", () => {
  test("Use this computer saves loopback settings from the started host", async () => {
    const { state } = target(DEFAULT_SETTINGS);
    await startThisComputer(bridge("ws://127.0.0.1:52011/v1/hc"), state);
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

  test("a saved loopback link whose host does not start at boot reports the typed cause and is never tried", async () => {
    const failure = { code: "hc-binary-missing", message: "not found", path: "hc", details: "raw output" };
    const { state, calls, failures } = target({ ...DEFAULT_SETTINGS, mode: "loopback", token: "old" });
    await bootConnection({ startLocalHost: () => Promise.reject(new HostStartError(failure)) }, state);
    expect(calls).toEqual(["restoring", "hostStartFailed"]);
    expect(failures).toEqual([failure]);
  });

  test("a start that fails without a typed failure is reported as unknown, with its message", () => {
    expect(startFailure(new Error("spawn failed"))).toEqual({
      code: "unknown",
      message: "spawn failed",
      details: "spawn failed",
    });
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

  test("a start the shell reports as failed rejects with that failure, typed", async () => {
    const failure = {
      code: "hc-binary-missing",
      message: "not found",
      path: "hc",
      searched: ["/h/.local/bin", "/h/.cargo/bin"],
      details: "raw output",
    };
    const failed = desktopBridge({ doriface: { startLocalHost: async () => ({ failure }) } });
    const error: unknown = await failed?.startLocalHost().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(HostStartError);
    expect(error instanceof HostStartError ? error.failure : undefined).toEqual(failure);
  });

  test("Choose hc is offered only by a shell that has it, and only a string answer is a chosen file", async () => {
    expect(desktopHcChooser({})).toBeNull();
    expect(desktopHcChooser({ doriface: { startLocalHost: async () => ({}) } })).toBeNull();
    const choose = desktopHcChooser({ doriface: { chooseHc: async () => "/opt/hc" } });
    expect(await choose?.()).toBe("/opt/hc");
    const odd = desktopHcChooser({ doriface: { chooseHc: async () => 7 } });
    expect(await odd?.()).toBeNull();
  });

  test("the shell's navigations reach the app only as app paths, and only through a bridge that offers them", () => {
    const shown: string[] = [];
    let send: (path: unknown) => void = noop;
    onDesktopNavigate((path) => shown.push(path), {
      doriface: { onNavigate: (listener: (path: unknown) => void) => (send = listener) },
    });
    for (const path of ["/settings", "//evil.example/x", "https://evil.example/", 42, "/pair#h=1"]) send(path);
    onDesktopNavigate((path) => shown.push(`web ${path}`), {});
    onDesktopNavigate((path) => shown.push(`old ${path}`), { doriface: { version: "0.1.0" } });
    expect(shown).toEqual(["/settings", "/pair#h=1"]);
  });

  test("the page background goes to a bridge that can paint the window, and nowhere else", () => {
    const painted: unknown[] = [];
    setDesktopBackground("#131518", {
      doriface: { setWindowBackground: async (color: unknown) => painted.push(color) },
    });
    setDesktopBackground("#131518", {});
    setDesktopBackground("#131518", { doriface: { version: "0.1.0" } });
    expect(painted).toEqual(["#131518"]);
  });

  test("closing the window goes through a bridge that can close it, and says when there is none", () => {
    let closes = 0;
    expect(closeDesktopWindow({ doriface: { closeWindow: async () => void (closes += 1) } })).toBe(true);
    expect(closeDesktopWindow({})).toBe(false);
    expect(closeDesktopWindow({ doriface: { version: "0.1.0" } })).toBe(false);
    expect(closes).toBe(1);
  });

  test("zooming goes to the desktop window when the bridge can zoom it, and says when there is none", () => {
    const steps: unknown[] = [];
    const doriface = { zoomWindow: async (step: unknown) => void steps.push(step) };
    expect(zoomDesktopWindow("out", { doriface })).toBe(true);
    expect(zoomDesktopWindow("reset", { doriface })).toBe(true);
    expect(zoomDesktopWindow("in", {})).toBe(false);
    expect(zoomDesktopWindow("in", { doriface: { version: "0.1.0" } })).toBe(false);
    expect(steps).toEqual(["out", "reset"]);
  });
});
