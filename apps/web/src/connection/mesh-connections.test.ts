import { afterEach, describe, expect, it } from "bun:test";
import { MeshConnections, type MemberConnection, type StoreFactory } from "./mesh-connections.ts";
import { DEFAULT_SETTINGS, loadSettings, type ConnectionSettings, type MemberTarget } from "./settings.ts";

const member = (hostId: string, hostName = hostId): MemberTarget => ({
  hostId,
  hostName,
  hostKey: `key-${hostId}`,
  directUrl: "",
});

const settingsWith = (members: readonly MemberTarget[], hostId = members[0]?.hostId ?? ""): ConnectionSettings => ({
  ...DEFAULT_SETTINGS,
  hostId,
  hostName: members.find((entry) => entry.hostId === hostId)?.hostName ?? "",
  hostKey: members.find((entry) => entry.hostId === hostId)?.hostKey ?? "",
  members,
});

/** A connection that opens on start and can be made to fail on its own, standing in for one member's store. */
class FakeConnection implements MemberConnection {
  #state: MemberConnection["state"] = { phase: "unconfigured" };
  readonly #listeners = new Set<() => void>();
  readonly #save: (settings: ConnectionSettings) => void;
  settings: ConnectionSettings;
  started = 0;
  stopped = 0;

  constructor(settings: ConnectionSettings, save: (settings: ConnectionSettings) => void) {
    this.settings = settings;
    this.#save = save;
  }

  get state(): MemberConnection["state"] {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    this.started += 1;
    this.#state = { phase: "open", connection: undefined as never, path: "relay" };
    this.#emit();
  }

  stop(): void {
    this.stopped += 1;
    this.#state = { phase: "unconfigured" };
    this.#emit();
  }

  retryNow(): void {}

  update(settings: ConnectionSettings): void {
    this.settings = settings;
  }

  restoring(): void {}

  restartsLocalHost(): void {}

  hostStartFailed(): void {}

  fail(): void {
    this.#state = { phase: "failed", error: new Error(`down`), retryInMs: 1_000, retryAt: 0, stale: null };
    this.rename(`renamed`);
    this.#emit();
  }

  rename(name: string): void {
    this.settings = { ...this.settings, hostName: name };
    this.#save(this.settings);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

const harness = (initial: ConnectionSettings) => {
  const made: FakeConnection[] = [];
  const saved: ConnectionSettings[] = [];
  const savers: ((settings: ConnectionSettings) => void)[] = [];
  const factory: StoreFactory = (settings, save) => {
    savers.push(save);
    const connection = new FakeConnection(settings, (next) => {
      saved.push(next);
      save(next);
    });
    made.push(connection);
    return connection;
  };
  return { mesh: new MeshConnections(initial, factory), made, saved, savers };
};

afterEach(() => {
  globalThis.localStorage?.clear?.();
});

describe("one connection per member", () => {
  it("dials every member of the roster, not only the selected one", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b"), member("c")]));
    expect(made).toHaveLength(3);
    expect(made.map((connection) => connection.settings.hostId)).toEqual(["a", "b", "c"]);
    expect(made.every((connection) => connection.started === 1)).toBe(true);
    expect(mesh.entries().map((entry) => entry.target.hostId)).toEqual(["a", "b", "c"]);
  });

  it("keeps the other members open when one host stops", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b"), member("c")]));
    const [first, second, third] = made;
    first?.fail();
    expect(second?.state.phase).toBe("open");
    expect(third?.state.phase).toBe("open");
    expect(mesh.entries().filter((entry) => entry.state.phase === "open")).toHaveLength(2);
  });

  it("shows the selected member's state, and switching shows another without closing any", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b")], "a"));
    expect(mesh.state.phase).toBe("open");
    mesh.select("b");
    expect(mesh.settings.hostId).toBe("b");
    expect(mesh.state.phase).toBe("open");
    expect(made.every((connection) => connection.stopped === 0)).toBe(true);
  });

  it("dials only the members the roster added, and stops one that left it", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b")]));
    made[0]?.fail();
    mesh.update(settingsWith([member("a"), member("c")], "a"));
    expect(made).toHaveLength(3);
    expect(made[1]?.stopped).toBe(1);
    expect(mesh.entries().map((entry) => entry.target.hostId)).toEqual(["a", "c"]);
  });

  it("gives a member's store a saver that writes nothing, so it cannot replace the roster", () => {
    const { savers } = harness(settingsWith([member("a"), member("b")]));
    const before = loadSettings();
    for (const save of savers) save(settingsWith([member("only")]));
    expect(loadSettings()).toEqual(before);
    expect(savers).toHaveLength(2);
  });

  it("folds a name a member answers with back into the roster", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b")]));
    made[0]?.fail();
    const renamed = mesh.entries().find((entry) => entry.target.hostId === "a");
    expect(renamed?.target.hostName).toBe("renamed");
    expect(mesh.settings.members.map((entry) => entry.hostName)).toContain("renamed");
  });

  it("still dials this computer's own host in loopback, which has no mesh id", () => {
    const { mesh, made } = harness({ ...DEFAULT_SETTINGS, mode: "loopback", loopbackUrl: "ws://127.0.0.1:7766/v1/hc" });
    expect(made).toHaveLength(1);
    expect(mesh.entries()).toHaveLength(1);
  });

  it("pairing replaces the roster, so a machine paired away from is not dialled again", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b")]));
    mesh.pair({ ...settingsWith([member("c")], "c"), members: [member("a"), member("b")] });
    expect(mesh.entries().map((entry) => entry.target.hostId)).toEqual(["c"]);
    expect(made.map((connection) => connection.settings.hostId)).toContain("c");
    expect(made.find((connection) => connection.settings.hostId === "a")?.stopped).toBe(1);
  });

  it("an ordinary edit keeps the roster rather than replacing it", () => {
    const initial = settingsWith([member("a"), member("b")]);
    const { mesh } = harness(initial);
    mesh.update({ ...initial, relayUrl: "wss://relay.example" });
    expect(mesh.entries().map((entry) => entry.target.hostId)).toEqual(["a", "b"]);
  });

  it("a new relay reaches the members already dialled, and leaves the untouched ones alone", () => {
    const initial = settingsWith([member("a"), member("b")]);
    const { mesh, made } = harness(initial);
    const before = made.map((connection) => connection.settings.relayUrl);
    mesh.update({ ...initial, relayUrl: "wss://relay.example" });
    expect(made.map((connection) => connection.settings.relayUrl)).toEqual([
      "wss://relay.example",
      "wss://relay.example",
    ]);
    expect(before).not.toEqual(["wss://relay.example", "wss://relay.example"]);
    expect(made.every((connection) => connection.stopped === 0)).toBe(true);
  });

  it("an edit that concerns no member does not touch their settings", () => {
    const initial = settingsWith([member("a"), member("b")]);
    const { mesh, made } = harness(initial);
    const held = made[0]?.settings;
    mesh.update({ ...initial, members: [...initial.members] });
    expect(made[0]?.settings).toBe(held);
  });

  it("reports unconfigured when there is no roster and nothing paired", () => {
    const { mesh, made } = harness({ ...DEFAULT_SETTINGS, mode: "relay" });
    expect(made).toHaveLength(0);
    expect(mesh.state.phase).toBe("unconfigured");
  });

  it("answers the same list until something changes, so a rendering store does not loop", () => {
    const { mesh, made } = harness(settingsWith([member("a"), member("b")]));
    const first = mesh.entries();
    expect(mesh.entries()).toBe(first);
    made[0]?.fail();
    const second = mesh.entries();
    expect(second).not.toBe(first);
    expect(second.find((entry) => entry.target.hostId === "a")?.state.phase).toBe("failed");
  });
});
