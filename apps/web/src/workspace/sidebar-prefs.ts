import type { AvatarColor } from "@doriface/ui";
import { AVATAR_COLORS } from "@doriface/ui";
import { useSyncExternalStore } from "react";
import { assignColors, type AgentSort } from "./sidebar-model.ts";

/** The sidebar's own choices that outlive a reload: how agents sort, and each space's avatar colour. */
export interface SidebarPrefs {
  readonly sort: AgentSort;
  readonly colors: Readonly<Record<string, AvatarColor>>;
}

export const SIDEBAR_KEY = "doriface.sidebar";
const DEFAULT: SidebarPrefs = { sort: "status", colors: {} };

const isColor = (value: unknown): value is AvatarColor => AVATAR_COLORS.some((color) => color === value);

export function loadSidebarPrefs(storage: Pick<Storage, "getItem"> = localStorage): SidebarPrefs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(SIDEBAR_KEY) ?? "null");
  } catch {
    return DEFAULT;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT;
  const sort: unknown = Reflect.get(parsed, "sort");
  const colors: unknown = Reflect.get(parsed, "colors");
  const kept =
    typeof colors === "object" && colors !== null
      ? Object.fromEntries(Object.entries(colors).filter((entry): entry is [string, AvatarColor] => isColor(entry[1])))
      : {};
  return { sort: sort === "space" ? "space" : "status", colors: kept };
}

class SidebarPrefsStore {
  #value = loadSidebarPrefs();
  #listeners = new Set<() => void>();
  get value(): SidebarPrefs {
    return this.#value;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  update(patch: Partial<SidebarPrefs>): void {
    this.#value = { ...this.#value, ...patch };
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify(this.#value));
    } finally {
      for (const listener of this.#listeners) listener();
    }
  }
}

export const sidebarPrefs = new SidebarPrefsStore();

export function useAgentSort(): readonly [AgentSort, (sort: AgentSort) => void] {
  const sort = useSyncExternalStore(sidebarPrefs.subscribe, () => sidebarPrefs.value.sort);
  return [sort, (next) => sidebarPrefs.update({ sort: next })];
}

/** Each listed space's colour; a new space gets one (and the choice is saved) the first time it is listed. */
export function useSpaceColors(ids: readonly string[]): Readonly<Record<string, AvatarColor>> {
  const saved = useSyncExternalStore(sidebarPrefs.subscribe, () => sidebarPrefs.value.colors);
  const next = assignColors(saved, ids);
  if (next !== saved)
    queueMicrotask(() => sidebarPrefs.update({ colors: assignColors(sidebarPrefs.value.colors, ids) }));
  return next;
}
