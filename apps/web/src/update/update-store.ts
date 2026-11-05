import { useSyncExternalStore } from "react";

/**
 * An update waiting to be applied: a new service worker (the web app reloads into it) or a release the desktop app
 * staged (it restarts into it). It lights the sidebar's Settings dot and Settings offers to apply it.
 */
export interface PendingUpdate {
  readonly apply: "reload" | "restart";
  /** The staged release's version; a waiting service worker has none. */
  readonly version?: string;
  readonly run: () => void;
}

class UpdateStore {
  #pending: PendingUpdate | null = null;
  #listeners = new Set<() => void>();
  get pending(): PendingUpdate | null {
    return this.#pending;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  set(pending: PendingUpdate | null): void {
    this.#pending = pending;
    for (const listener of this.#listeners) listener();
  }
}

export const updateStore = new UpdateStore();

export function usePendingUpdate(): PendingUpdate | null {
  return useSyncExternalStore(updateStore.subscribe, () => updateStore.pending);
}
