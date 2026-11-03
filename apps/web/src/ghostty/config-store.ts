import { useSyncExternalStore } from "react";
import { deviceStore, memoryStore, type KeyValueStore } from "../storage/idb.ts";
import { EMPTY_CONFIG, type TerminalConfig } from "./config.ts";
import { KEY_BY_NAME } from "./keys.ts";

const KEY = "terminal-config";
const LEGACY_APPEARANCE = "doriface.appearance";
/** The old appearance font size defaulted to 14 px; only a changed value is worth carrying over. */
const LEGACY_DEFAULT_PX = 14;

function revive(stored: unknown): TerminalConfig {
  if (!Array.isArray(stored)) return EMPTY_CONFIG;
  const config = new Map<string, readonly string[]>();
  for (const entry of stored) {
    if (!Array.isArray(entry)) continue;
    const [key, values] = entry;
    if (typeof key === "string" && KEY_BY_NAME.has(key) && Array.isArray(values)) {
      config.set(
        key,
        values.filter((v): v is string => typeof v === "string"),
      );
    }
  }
  return config;
}

/** The terminal font size older builds kept in the appearance settings, in pixels. */
export interface LegacyFontSize {
  /** The size worth carrying over, or null when there is none or it was the old default. */
  read(): number | null;
  /** Drops it from the appearance record; called only once the migrated value is stored. */
  clear(): void;
}

export const NO_LEGACY_FONT_SIZE: LegacyFontSize = { read: () => null, clear: () => undefined };

function parseAppearance(storage: Pick<Storage, "getItem">): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LEGACY_APPEARANCE) ?? "null");
    return typeof parsed === "object" && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : null;
  } catch {
    return null;
  }
}

export function legacyFontSize(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): LegacyFontSize {
  return {
    read: () => {
      const size = parseAppearance(storage)?.["fontSize"];
      return typeof size === "number" && size !== LEGACY_DEFAULT_PX ? size : null;
    },
    clear: () => {
      const appearance = parseAppearance(storage);
      if (appearance === null || !("fontSize" in appearance)) return;
      const { fontSize: _dropped, ...rest } = appearance;
      storage.setItem(LEGACY_APPEARANCE, JSON.stringify(rest));
    },
  };
}

/** Ghostty sizes fonts in points; 1 px is 0.75 pt, kept to the half-point steps the control offers. */
const pxToPt = (px: number): string => String(Math.round(px * 1.5) / 2);

/**
 * The device's terminal config: loaded from IndexedDB once, saved on every change, observed by open
 * terminals. Changes are updaters applied in order on top of the loaded value, so one made before the
 * load finishes keeps every stored setting.
 */
export class TerminalConfigStore {
  #config: TerminalConfig = EMPTY_CONFIG;
  #queue: Promise<void>;
  #error: Error | null = null;
  #listeners = new Set<() => void>();
  readonly #storage: KeyValueStore;
  readonly loaded: Promise<void>;

  constructor(storage: KeyValueStore, legacy: LegacyFontSize = NO_LEGACY_FONT_SIZE) {
    this.#storage = storage;
    this.loaded = this.#load(legacy).catch((cause: unknown) => {
      this.#error = cause instanceof Error ? cause : new Error(String(cause));
      for (const listener of this.#listeners) listener();
    });
    this.#queue = this.loaded;
  }

  get config(): TerminalConfig {
    return this.#config;
  }

  /** Set when the stored value could not be read; writes are refused so nothing stored is overwritten. */
  get error(): Error | null {
    return this.#error;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(change: (current: TerminalConfig) => TerminalConfig): Promise<void> {
    const applied = this.#queue.then(async () => this.#apply(change));
    this.#queue = applied.catch(() => undefined);
    return applied;
  }

  async #apply(change: (current: TerminalConfig) => TerminalConfig): Promise<void> {
    if (this.#error !== null) return;
    const next = change(this.#config);
    this.#set(next);
    await this.#storage.put(KEY, [...next]);
  }

  async #load(legacy: LegacyFontSize): Promise<void> {
    const stored = await this.#storage.get(KEY);
    if (stored !== undefined) return this.#set(revive(stored));
    const px = legacy.read();
    if (px === null) return legacy.clear();
    const migrated: TerminalConfig = new Map([["font-size", [pxToPt(px)]]]);
    await this.#storage.put(KEY, [...migrated]);
    this.#set(migrated);
    legacy.clear();
  }

  #set(config: TerminalConfig): void {
    this.#config = config;
    for (const listener of this.#listeners) listener();
  }
}

export const terminalConfigStore =
  typeof indexedDB === "undefined"
    ? new TerminalConfigStore(memoryStore())
    : new TerminalConfigStore(deviceStore, legacyFontSize());

export function useTerminalConfig(store: TerminalConfigStore = terminalConfigStore): TerminalConfig {
  return useSyncExternalStore(store.subscribe, () => store.config);
}

export function useTerminalConfigError(store: TerminalConfigStore = terminalConfigStore): Error | null {
  return useSyncExternalStore(store.subscribe, () => store.error);
}
