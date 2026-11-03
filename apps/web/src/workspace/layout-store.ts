import { useSyncExternalStore } from "react";
import { loadLayout, LAYOUT_KEY, type Layout } from "./layout.ts";

class LayoutStore {
  #value = loadLayout();
  #listeners = new Set<() => void>();
  get value(): Layout {
    return this.#value;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  update(patch: Partial<Layout>): void {
    this.#value = { ...this.#value, ...patch };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.#value));
    for (const listener of this.#listeners) listener();
  }
}

export const layoutStore = new LayoutStore();

/** Whether the desktop sidebar is shown, and its setter (a value or an updater, like useState's). */
export function useSidebarShown(): readonly [boolean, (next: boolean | ((shown: boolean) => boolean)) => void] {
  const shown = useSyncExternalStore(layoutStore.subscribe, () => layoutStore.value.sidebar);
  const set = (next: boolean | ((current: boolean) => boolean)): void => {
    layoutStore.update({ sidebar: typeof next === "function" ? next(layoutStore.value.sidebar) : next });
  };
  return [shown, set];
}
