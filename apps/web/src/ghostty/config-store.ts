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

/** The terminal font size older builds kept in the appearance settings, in pixels, removed once read. */
export function takeLegacyFontSize(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(LEGACY_APPEARANCE) ?? "null");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const size: unknown = Reflect.get(parsed, "fontSize");
  if (typeof size !== "number") return null;
  const { fontSize: _dropped, ...rest } = Object.fromEntries(Object.entries(parsed));
  storage.setItem(LEGACY_APPEARANCE, JSON.stringify(rest));
  return size === LEGACY_DEFAULT_PX ? null : size;
}

/** Ghostty sizes fonts in points; 1 px is 0.75 pt, kept to the half-point steps the control offers. */
const pxToPt = (px: number): string => String(Math.round(px * 1.5) / 2);

/**
 * The device's terminal config: loaded from IndexedDB once, saved on every change, observed by open
 * terminals. A change made before the load finishes wins over the stored value.
 */
export class TerminalConfigStore {
  #config: TerminalConfig = EMPTY_CONFIG;
  #dirty = false;
  #listeners = new Set<() => void>();
  readonly #storage: KeyValueStore;
  readonly loaded: Promise<void>;

  constructor(storage: KeyValueStore, legacyFontSize: () => number | null = () => null) {
    this.#storage = storage;
    this.loaded = this.#load(legacyFontSize);
  }

  get config(): TerminalConfig {
    return this.#config;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(config: TerminalConfig): Promise<void> {
    this.#dirty = true;
    this.#set(config);
    return this.#storage.put(KEY, [...config]);
  }

  async #load(legacyFontSize: () => number | null): Promise<void> {
    const stored = await this.#storage.get(KEY).catch(() => undefined);
    if (this.#dirty) return;
    if (stored !== undefined) return this.#set(revive(stored));
    const px = legacyFontSize();
    if (px === null) return;
    const migrated: TerminalConfig = new Map([["font-size", [pxToPt(px)]]]);
    this.#set(migrated);
    await this.#storage.put(KEY, [...migrated]).catch(() => undefined);
  }

  #set(config: TerminalConfig): void {
    this.#config = config;
    for (const listener of this.#listeners) listener();
  }
}

export const terminalConfigStore =
  typeof indexedDB === "undefined"
    ? new TerminalConfigStore(memoryStore())
    : new TerminalConfigStore(deviceStore, () => takeLegacyFontSize());

export function useTerminalConfig(store: TerminalConfigStore = terminalConfigStore): TerminalConfig {
  return useSyncExternalStore(store.subscribe, () => store.config);
}
