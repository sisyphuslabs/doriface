import type { EventFeed, HcConnection } from "@doriface/client";
import { DEFAULT_PUSH_PREFS, type HcEvent, parsePushClientLine, type PushPrefs } from "@doriface/protocol";
import { type ConnectionState, connectionStore } from "../connection/store.ts";
import { NoticeTrigger, type Trigger, wanted } from "./notice-trigger.ts";
import type { PushView } from "./push-settings.ts";

/** The desktop shell's native notifications (apps/desktop/src/shared/bridge.ts), read as an untrusted boundary. */
export interface NoticeBridge {
  supported(): Promise<boolean>;
  show(notice: { readonly kind: Trigger["kind"] | "test"; readonly terminal: string | null }): Promise<boolean>;
  onClick(listener: (terminal: string | null) => void): void;
}

export function noticeBridge(scope: object = globalThis): NoticeBridge | null {
  const bridge: unknown = Reflect.get(scope, "doriface");
  if (typeof bridge !== "object" || bridge === null) return null;
  const method = (name: string): ((...args: unknown[]) => unknown) | null => {
    const found: unknown = Reflect.get(bridge, name);
    return typeof found === "function" ? (...args) => Reflect.apply(found, bridge, args) : null;
  };
  const supported = method("noticesSupported");
  const show = method("showNotice");
  const onClick = method("onNoticeClick");
  if (supported === null || show === null || onClick === null) return null;
  return {
    supported: async () => (await supported()) === true,
    show: async (notice) => (await show(notice)) === true,
    onClick: (listener) =>
      void onClick((terminal: unknown) => {
        if (terminal === null || typeof terminal === "string") listener(terminal);
      }),
  };
}

export const DESKTOP_NOTICES_KEY = "doriface.desktop-notices";

export interface SavedNotices {
  readonly on: boolean;
  readonly prefs: PushPrefs;
}

/** What Settings saved here; anything unreadable is notifications off with every event. */
export function parseSavedNotices(raw: string | null): SavedNotices {
  const off: SavedNotices = { on: false, prefs: DEFAULT_PUSH_PREFS };
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value !== "object" || value === null) return off;
    const prefs: unknown = Reflect.get(value, "prefs");
    const line = parsePushClientLine(JSON.stringify({ t: "prefs", endpoint: "https://prefs.invalid/", prefs }));
    return { on: Reflect.get(value, "on") === true, prefs: line.t === "prefs" ? line.prefs : DEFAULT_PUSH_PREFS };
  } catch {
    return off;
  }
}

export interface NoticeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DesktopNoticesOptions {
  readonly bridge: NoticeBridge;
  readonly storage: NoticeStorage;
  readonly connection: Pick<typeof connectionStore, "state" | "subscribe">;
  readonly now?: () => number;
}

/**
 * Settings > Notifications in the desktop app: native notifications from this app's own event feed, on the same
 * triggers, kinds and machine mutes as web push. They come while the app runs, its window in the background or hidden.
 */
export class DesktopNotices {
  readonly #options: DesktopNoticesOptions;
  readonly #listeners = new Set<() => void>();
  readonly #trigger = new NoticeTrigger();
  #view: PushView;
  #connection: HcConnection | null = null;
  #feed: EventFeed | undefined;
  #shown: string | null = null;

  constructor(options: DesktopNoticesOptions) {
    this.#options = options;
    const saved = parseSavedNotices(options.storage.getItem(DESKTOP_NOTICES_KEY));
    this.#view = { support: "supported", permission: null, busy: false, error: null, tested: false, ...saved };
    options.connection.subscribe(() => this.#follow());
    this.#follow();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get view(): PushView {
    return this.#view;
  }

  async load(): Promise<void> {
    await this.#run("read the notification settings", async () => {
      const supported = await this.#options.bridge.supported();
      this.#set({ support: supported ? "supported" : "desktop-app" });
    });
  }

  async turnOn(): Promise<void> {
    this.#save({ on: true });
  }

  async turnOff(): Promise<void> {
    this.#save({ on: false, tested: false });
  }

  async setPrefs(prefs: PushPrefs): Promise<void> {
    this.#save({ prefs });
  }

  async test(): Promise<void> {
    await this.#run("send a test notification", async () => {
      if (!(await this.#options.bridge.show({ kind: "test", terminal: null }))) throw new Error("it was refused");
      this.#set({ tested: true });
    });
  }

  /** The pane this window shows focused and visible, or null: no notification comes about it. */
  focus(terminal: string | null): void {
    this.#shown = terminal;
  }

  #heard(event: HcEvent): void {
    const hit = this.#trigger.event(event, (this.#options.now ?? Date.now)());
    if (hit === undefined || !this.#view.on || !wanted(hit, this.#view.prefs, this.#shown)) return;
    this.#options.bridge.show({ kind: hit.kind, terminal: hit.terminal }).catch((error: unknown) => {
      console.error(`notification: ${String(error)}`);
    });
  }

  /** Keeps one event feed open on the live connection while notifications are on, and none otherwise. */
  #follow(): void {
    const state: ConnectionState = this.#options.connection.state;
    const connection = this.#view.on && state.phase === "open" ? state.connection : null;
    if (connection === this.#connection) return;
    const old = this.#feed;
    this.#feed = undefined;
    this.#connection = connection;
    old?.close();
    if (connection !== null) void this.#attach(connection);
  }

  async #attach(connection: HcConnection): Promise<void> {
    let feed: EventFeed;
    try {
      feed = await connection.subscribe();
    } catch (error) {
      console.error(`notifications: could not follow the agents: ${String(error)}`);
      return;
    }
    if (this.#connection !== connection) return feed.close();
    this.#feed = feed;
    this.#trigger.baseline(feed.snapshot.terminals);
    feed.onSnapshot((snapshot) => this.#trigger.baseline(snapshot.terminals));
    feed.onEvent((event) => this.#heard(event));
    // A feed that ended while the connection stays (a missed heartbeat) is opened again.
    feed.onClose(() => {
      if (this.#feed !== feed) return;
      this.#feed = undefined;
      this.#connection = null;
      if (!connection.closed) this.#follow();
    });
  }

  #save(change: Partial<SavedNotices> & Partial<PushView>): void {
    this.#set(change);
    const { on, prefs } = this.#view;
    this.#options.storage.setItem(DESKTOP_NOTICES_KEY, JSON.stringify({ on, prefs }));
    this.#follow();
  }

  async #run(what: string, step: () => Promise<void>): Promise<void> {
    this.#set({ busy: true, error: null });
    try {
      await step();
      this.#set({ busy: false });
    } catch (error) {
      this.#set({ busy: false, error: `Could not ${what}. ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  #set(change: Partial<PushView>): void {
    this.#view = { ...this.#view, ...change };
    for (const listener of this.#listeners) listener();
  }
}

const bridge = noticeBridge();

/** The desktop app's notifications; null in a browser, where web push does this. */
export const desktopNotices: DesktopNotices | null =
  bridge === null ? null : new DesktopNotices({ bridge, storage: localStorage, connection: connectionStore });
