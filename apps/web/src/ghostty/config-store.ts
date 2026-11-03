import { useSyncExternalStore } from "react";
import { deviceStore, type KeyValueStore } from "../storage/idb.ts";
import { EMPTY_CONFIG, type TerminalConfig } from "./config.ts";
import { KEY_BY_NAME } from "./keys.ts";

const KEY = "terminal-config";

function revive(stored: unknown): TerminalConfig {
  if (!Array.isArray(stored)) return EMPTY_CONFIG;
  const config = new Map<string, readonly string[]>();
  for (const entry of stored) {
    if (!Array.isArray(entry)) continue;
    const [key, values] = entry;
    if (
      typeof key === "string" &&
      KEY_BY_NAME.has(key) &&
      Array.isArray(values) &&
      values.every((v) => typeof v === "string")
    ) {
      config.set(
        key,
        values.filter((v): v is string => typeof v === "string"),
      );
    }
  }
  return config;
}

/** The device's terminal config: loaded from IndexedDB once, saved on every change, observed by open terminals. */
export class TerminalConfigStore {
  #config: TerminalConfig = EMPTY_CONFIG;
  #listeners = new Set<() => void>();
  readonly #storage: KeyValueStore;
  readonly loaded: Promise<void>;

  constructor(storage: KeyValueStore) {
    this.#storage = storage;
    this.loaded = storage.get(KEY).then(
      (stored) => this.#set(revive(stored)),
      () => undefined,
    );
  }

  get config(): TerminalConfig {
    return this.#config;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(config: TerminalConfig): Promise<void> {
    this.#set(config);
    return this.#storage.put(KEY, [...config]);
  }

  #set(config: TerminalConfig): void {
    this.#config = config;
    for (const listener of this.#listeners) listener();
  }
}

export const terminalConfigStore = new TerminalConfigStore(
  typeof indexedDB === "undefined" ? { get: async () => undefined, put: async () => undefined } : deviceStore,
);

export function useTerminalConfig(store: TerminalConfigStore = terminalConfigStore): TerminalConfig {
  return useSyncExternalStore(store.subscribe, () => store.config);
}
