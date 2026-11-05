import { describe, expect, test } from "bun:test";
import type { EventFeed, HcConnection } from "@doriface/client";
import { DEFAULT_PUSH_PREFS, type HcEvent, type Status, type Terminal } from "@doriface/protocol";
import type { ConnectionState } from "../connection/store.ts";

// store.ts builds the app's store from localStorage as it loads; bun has none, so an empty one stands in for that load only.
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => undefined } });
const { DESKTOP_NOTICES_KEY, DesktopNotices, parseSavedNotices } = await import("./desktop-notices.ts");
const { REPEAT_MS } = await import("./notice-trigger.ts");
Reflect.deleteProperty(globalThis, "localStorage");

const terminal = (address: string, status: Status | null): Terminal => ({
  address,
  argv: ["agent"],
  cols: 80,
  rows: 24,
  created_ms: 1,
  cwd: "/work",
  labels: {},
  screen: "exact",
  state: "live",
  status,
  status_ms: 1_000,
  turn: 2,
});

let seq = 1;
const status = (address: string, state: Status, machine?: string): HcEvent => ({
  type: "status",
  seq: seq++,
  terminal: address,
  ...(machine === undefined ? {} : { machine }),
  data: { status: state, records: {}, reported: true },
});

class FakeFeed {
  readonly #events = new Set<(event: HcEvent) => void>();
  readonly #closes = new Set<() => void>();
  readonly snapshot: { readonly seq: number; readonly terminals: readonly Terminal[] };
  closed = false;
  constructor(snapshot: FakeFeed["snapshot"]) {
    this.snapshot = snapshot;
  }
  onEvent = (listener: (event: HcEvent) => void) => (this.#events.add(listener), () => undefined);
  onSnapshot = () => () => undefined;
  onClose = (listener: () => void) => (this.#closes.add(listener), () => undefined);
  close = (): void => {
    this.closed = true;
    for (const listener of this.#closes) listener();
  };
  emit(event: HcEvent): void {
    for (const listener of this.#events) listener(event);
  }
}

function rig({ saved = null as string | null, supported = true, shows = true, terminals = [] as Terminal[] } = {}) {
  const feeds: FakeFeed[] = [];
  const live: Pick<HcConnection, "subscribe" | "closed"> = {
    closed: false,
    subscribe: async () => {
      const feed = new FakeFeed({ seq: 0, terminals });
      feeds.push(feed);
      return feed as unknown as EventFeed;
    },
  };
  const listeners = new Set<() => void>();
  const connection = {
    state: { phase: "open", connection: live as HcConnection } as ConnectionState,
    subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
    move(state: ConnectionState) {
      this.state = state;
      for (const listener of listeners) listener();
    },
  };
  const stored = new Map<string, string>(saved === null ? [] : [[DESKTOP_NOTICES_KEY, saved]]);
  const shown: { kind: string; terminal: string | null }[] = [];
  let now = 0;
  const notices = new DesktopNotices({
    bridge: {
      supported: async () => supported,
      show: async (notice) => (shows && shown.push(notice), shows),
      onClick: () => undefined,
    },
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) },
    connection,
    now: () => now,
  });
  const feed = async (): Promise<FakeFeed> => {
    await Promise.resolve();
    const last = feeds.at(-1);
    if (last === undefined) throw new Error("no feed was opened");
    return last;
  };
  const reopen = () => connection.move({ phase: "open", connection: live as HcConnection });
  return { notices, feeds, feed, shown, stored, connection, reopen, tick: (ms: number) => void (now += ms) };
}

const done: Status = { state: "done" };

describe("the desktop app's native notifications", () => {
  test("off until Turn on: no feed is opened and nothing is shown", async () => {
    const { notices, feeds } = rig();
    expect(notices.view).toMatchObject({ on: false, support: "supported", prefs: DEFAULT_PUSH_PREFS });
    await Promise.resolve();
    expect(feeds).toHaveLength(0);
  });

  test("on: a turn that finishes, asks or fails is one notice naming its terminal; the snapshot stays quiet", async () => {
    const { notices, feed, shown, stored } = rig({ terminals: [terminal("t1", { state: "blocked" })] });
    await notices.turnOn();
    const events = await feed();
    events.emit(status("t1", { state: "blocked" }));
    events.emit(status("t2", done));
    events.emit(status("t3", { state: "blocked", kind: "permission" }));
    events.emit(status("t4", { state: "error" }, "box"));
    events.emit(status("t5", { state: "working" }));
    expect(shown).toEqual([
      { kind: "done", terminal: "t2" },
      { kind: "permission", terminal: "t3" },
      { kind: "error", terminal: "box/t4" },
    ]);
    expect(parseSavedNotices(stored.get(DESKTOP_NOTICES_KEY) ?? null).on).toBe(true);
  });

  test("an agent flapping back into the same state within 30 s is one notice", async () => {
    const { notices, feed, shown, tick } = rig();
    await notices.turnOn();
    const events = await feed();
    events.emit(status("t1", done));
    events.emit(status("t1", { state: "working" }));
    events.emit(status("t1", done));
    tick(REPEAT_MS);
    events.emit(status("t1", { state: "working" }));
    events.emit(status("t1", done));
    expect(shown).toEqual([
      { kind: "done", terminal: "t1" },
      { kind: "done", terminal: "t1" },
    ]);
  });

  test("a turned-off event, a muted machine and the pane in view show nothing", async () => {
    const { notices, feed, shown } = rig();
    await notices.turnOn();
    await notices.setPrefs({ events: { ...DEFAULT_PUSH_PREFS.events, done: false }, muted: ["machine:box"] });
    notices.focus("t3");
    const events = await feed();
    events.emit(status("t1", done));
    events.emit(status("t2", { state: "error" }, "box"));
    events.emit(status("t3", { state: "error" }));
    events.emit(status("t4", { state: "error" }));
    expect(shown).toEqual([{ kind: "error", terminal: "t4" }]);
  });

  test("Turn off and a dropped connection close the feed; a saved on follows the next connection", async () => {
    const saved = JSON.stringify({ on: true, prefs: DEFAULT_PUSH_PREFS });
    const { notices, feeds, feed, connection, reopen } = rig({ saved });
    expect(notices.view.on).toBe(true);
    const first = await feed();
    connection.move({ phase: "connecting", attempt: 1, stale: null });
    expect(first.closed).toBe(true);
    reopen();
    const second = await feed();
    expect(second).not.toBe(first);
    await notices.turnOff();
    expect(second.closed).toBe(true);
    expect(feeds).toHaveLength(2);
  });

  test("Send test shows a test notice; a refused one and a system without notifications say so", async () => {
    const working = rig();
    await working.notices.test();
    expect(working.shown).toEqual([{ kind: "test", terminal: null }]);
    expect(working.notices.view).toMatchObject({ tested: true, error: null });

    const refused = rig({ shows: false });
    await refused.notices.test();
    expect(refused.notices.view.error).toBe("Could not send a test notification. it was refused");

    const none = rig({ supported: false });
    await none.notices.load();
    expect(none.notices.view.support).toBe("desktop-app");
  });

  test("saved settings that cannot be read are notifications off with every event", () => {
    for (const raw of [null, "{", "[]", JSON.stringify({ on: "yes", prefs: { events: 1 } })]) {
      expect(parseSavedNotices(raw)).toEqual({ on: false, prefs: DEFAULT_PUSH_PREFS });
    }
  });
});
