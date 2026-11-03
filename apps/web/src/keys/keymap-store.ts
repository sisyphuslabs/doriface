import { useSyncExternalStore } from "react";
import { deviceStore, memoryStore, type KeyValueStore } from "../storage/idb.ts";
import { checkBinding, NO_OVERRIDES, type Overrides } from "./keymap.ts";

const KEY = "keymap";
export const KEYMAP_VERSION = 1;

interface Stored {
  readonly version: number;
  readonly bindings: readonly (readonly [string, string | null])[];
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== "object" || value === null) return false;
  const version: unknown = Reflect.get(value, "version");
  const bindings: unknown = Reflect.get(value, "bindings");
  return typeof version === "number" && Array.isArray(bindings);
}

/** Older layouts are read through here; a shape this version cannot read keeps the defaults. */
function migrate(stored: Stored): Overrides {
  const overrides = new Map<string, string | null>();
  for (const entry of stored.bindings) {
    if (!Array.isArray(entry)) continue;
    const [trigger, action] = entry;
    if (typeof trigger !== "string" || (typeof action !== "string" && action !== null)) continue;
    const checked = checkBinding(trigger, action);
    if (checked.ok) overrides.set(checked.trigger, action);
  }
  return overrides;
}

export class KeymapStore {
  #overrides: Overrides = NO_OVERRIDES;
  #listeners = new Set<() => void>();
  readonly #storage: KeyValueStore;
  readonly loaded: Promise<void>;

  constructor(storage: KeyValueStore) {
    this.#storage = storage;
    this.loaded = this.#load();
  }

  get overrides(): Overrides {
    return this.#overrides;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Refuses the whole write when any binding is invalid, so storage never holds a bad trigger. */
  update(overrides: Overrides): Promise<void> {
    for (const [trigger, action] of overrides) {
      const checked = checkBinding(trigger, action);
      if (!checked.ok) return Promise.reject(new Error(checked.reason));
    }
    this.#set(overrides);
    const stored: Stored = { version: KEYMAP_VERSION, bindings: [...overrides] };
    return this.#storage.put(KEY, stored);
  }

  async #load(): Promise<void> {
    const raw = await this.#storage.get(KEY).catch(() => undefined);
    if (!isStored(raw)) return;
    if (raw.version !== KEYMAP_VERSION) {
      await this.#storage.put(`${KEY}.backup.v${raw.version}`, raw);
      const migrated = migrate(raw);
      await this.#storage.put(KEY, { version: KEYMAP_VERSION, bindings: [...migrated] });
      this.#set(migrated);
      return;
    }
    this.#set(migrate(raw));
  }

  #set(overrides: Overrides): void {
    this.#overrides = overrides;
    for (const listener of this.#listeners) listener();
  }
}

export const keymapStore = new KeymapStore(typeof indexedDB === "undefined" ? memoryStore() : deviceStore);

export function useOverrides(store: KeymapStore = keymapStore): Overrides {
  return useSyncExternalStore(store.subscribe, () => store.overrides);
}
