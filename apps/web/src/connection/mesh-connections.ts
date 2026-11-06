import type { ConnectionState } from "./store.ts";
import type { HostStartFailure } from "../desktop/bridge.ts";
import type { LocalHostStarter } from "./store.ts";
import type { ConnectionSettings, MemberTarget, Saver } from "./settings.ts";
import { normalizeSettings, saveSettings } from "./settings.ts";

/**
 * What the mesh needs from one member's connection. `ConnectionStore` satisfies it structurally; declaring it here keeps this
 * module free of a runtime import back into the store, so the two never form an import cycle.
 */
export interface MemberConnection {
  readonly settings: ConnectionSettings;
  readonly state: ConnectionState;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  retryNow(): void;
  update(settings: ConnectionSettings): void;
  restoring(): void;
  restartsLocalHost(starter: LocalHostStarter): void;
  hostStartFailed(failure: HostStartFailure): void;
}

export type StoreFactory = (settings: ConnectionSettings, save: Saver) => MemberConnection;

/** One member and the connection this app holds to it, which is independent of every other member's. */
export interface MemberEntry {
  readonly target: MemberTarget;
  readonly state: ConnectionState;
}

/**
 * One connection per member, so a machine going away removes that machine and nothing else.
 *
 * Before this, the app held a single connection and, when it failed, moved the selection to the next member and dialled again:
 * one machine stopping meant every session this app had died with it, which is the behaviour Q reported ("if Air turns off,
 * everything turns off"). Here every member of the roster gets its own connection and its own retry ladder, so the others are
 * untouched when one host stops.
 *
 * A member's store is dialled with a roster of just itself. Rotation inside a store exists for the single-connection case, and
 * a per-member store that rotated would dial a member that already has its own connection; with a one-entry roster that code
 * cannot move at all.
 */
export class MeshConnections {
  #settings: ConnectionSettings;
  readonly #make: StoreFactory;
  readonly #stores = new Map<string, MemberConnection>();
  readonly #targets = new Map<string, MemberTarget>();
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribes = new Map<string, () => void>();
  /**
   * The list `entries()` answers with. Rebuilt only when something changes, because it is read through
   * `useSyncExternalStore`, which compares snapshots by identity and would re-render forever on a fresh array per call.
   */
  #snapshot: readonly MemberEntry[] = [];

  constructor(settings: ConnectionSettings, make: StoreFactory) {
    this.#settings = normalizeSettings(settings);
    this.#make = make;
    this.#sync();
    this.#refresh();
  }

  get settings(): ConnectionSettings {
    return this.#settings;
  }

  /** The selected member's connection, which is the one the workspace shows. */
  get selected(): MemberConnection | undefined {
    return this.#stores.get(this.#settings.hostId);
  }

  get state(): ConnectionState {
    return this.selected?.state ?? { phase: "unconfigured" };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Every member and its own connection state, for a list that marks one machine offline instead of the whole app. */
  entries(): readonly MemberEntry[] {
    return this.#snapshot;
  }

  /** Takes new settings, and dials whatever the new roster adds while leaving connections that are still members alone. */
  update(settings: ConnectionSettings): void {
    this.#settings = normalizeSettings(settings);
    saveSettings(this.#settings);
    this.#sync();
    this.#notify();
  }

  /** Shows another member's connection without touching any connection: the others stay open while this app looks elsewhere. */
  select(hostId: string): void {
    if (hostId === this.#settings.hostId || !this.#targets.has(hostId)) return;
    const target = this.#targets.get(hostId);
    if (target === undefined) return;
    this.#settings = {
      ...this.#settings,
      hostId: target.hostId,
      hostName: target.hostName,
      hostKey: target.hostKey,
      directUrl: target.directUrl,
    };
    saveSettings(this.#settings);
    this.#notify();
  }

  start(): void {
    for (const store of this.#stores.values()) store.start();
  }

  /** The desktop app restarting this computer's own host: only the member on loopback is affected. */
  restoring(): void {
    this.selected?.restoring();
  }

  restartsLocalHost(starter: LocalHostStarter): void {
    this.selected?.restartsLocalHost(starter);
  }

  hostStartFailed(failure: HostStartFailure): void {
    this.selected?.hostStartFailed(failure);
  }

  stop(): void {
    for (const store of this.#stores.values()) store.stop();
  }

  retryNow(): void {
    for (const store of this.#stores.values()) store.retryNow();
  }

  /** The members this app dials: the roster, plus the selected host when the two disagree so it is never left unreachable. */
  #roster(): readonly MemberTarget[] {
    const { members, hostId, hostName, hostKey, directUrl, mode } = this.#settings;
    const selected: MemberTarget = { hostId, hostName, hostKey, directUrl };
    if (members.some((member) => member.hostId === hostId)) return members;
    // Loopback is this computer's own host, which has no mesh id to pair with: it is still the one member it dials, and leaving
    // it out would show the desktop app unconfigured while its own host is running.
    if (hostId === "" && mode !== "loopback") return members;
    return [selected, ...members];
  }

  #sync(): void {
    const roster = this.#roster();
    const keep = new Set(roster.map((member) => member.hostId));
    for (const [hostId, unsubscribe] of this.#unsubscribes) {
      if (keep.has(hostId)) continue;
      unsubscribe();
      this.#unsubscribes.delete(hostId);
      this.#stores.get(hostId)?.stop();
      this.#stores.delete(hostId);
      this.#targets.delete(hostId);
    }
    for (const member of roster) {
      const existing = this.#stores.get(member.hostId);
      if (existing !== undefined) {
        this.#targets.set(member.hostId, member);
        continue;
      }
      this.#targets.set(member.hostId, member);
      this.#stores.set(member.hostId, this.#dial(member));
    }
  }

  #dial(member: MemberTarget): MemberConnection {
    const scoped: ConnectionSettings = {
      ...this.#settings,
      hostId: member.hostId,
      hostName: member.hostName,
      hostKey: member.hostKey,
      directUrl: member.directUrl,
      members: [member],
    };
    // A member's store holds a slice of a roster this object owns, so it must not write: saving its slice would replace the
    // roster with one member.
    const store = this.#make(scoped, () => undefined);
    store.start();
    this.#unsubscribes.set(
      member.hostId,
      store.subscribe(() => this.#adoptName(member.hostId, store)),
    );
    return store;
  }

  /**
   * A member names itself as it answers, and that name is the only way to label it while it is down (#496). The name arrives on
   * the member's own store, so it is folded back into the roster and saved here, the one place the roster is written.
   */
  #adoptName(hostId: string, store: MemberConnection): void {
    const name = store.settings.hostName;
    const target = this.#targets.get(hostId);
    if (target === undefined || name === "" || name === target.hostName) {
      this.#notify();
      return;
    }
    const renamed: MemberTarget = { ...target, hostName: name };
    this.#targets.set(hostId, renamed);
    const members = this.#settings.members.map((member) => (member.hostId === hostId ? renamed : member));
    const selected = this.#settings.hostId === hostId ? { hostName: name } : {};
    this.#settings = normalizeSettings({ ...this.#settings, ...selected, members });
    saveSettings(this.#settings);
    this.#notify();
  }

  #refresh(): void {
    this.#snapshot = [...this.#targets.values()].map((target) => ({
      target,
      state: this.#stores.get(target.hostId)?.state ?? { phase: "unconfigured" },
    }));
  }

  #notify(): void {
    this.#refresh();
    for (const listener of this.#listeners) listener();
  }
}
