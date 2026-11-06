import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { ScreenAwake, type ScreenWakeLock } from "./wake-lock.ts";
import { guardedLocalStorage } from "../storage/guarded.ts";

const KEY = "doriface.device.keep-awake";

/** The browser's Screen Wake Lock, or null where it has none (an older Safari, Firefox before 126). */
export function screenWakeLock(scope: object = globalThis.navigator): ScreenWakeLock | null {
  const lock: unknown = Reflect.get(scope, "wakeLock");
  return typeof lock === "object" && lock !== null && typeof Reflect.get(lock, "request") === "function"
    ? {
        request: (type) => Reflect.apply(Reflect.get(lock, "request"), lock, [type]),
      }
    : null;
}

/** Off unless stored as on; storage that refuses the read leaves it off, so the app still starts. */
function storedKeepAwake(): boolean {
  return guardedLocalStorage().getItem(KEY) === "true";
}

class KeepAwakeStore {
  #value = storedKeepAwake();
  #listeners = new Set<() => void>();
  get value(): boolean {
    return this.#value;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  set(value: boolean): void {
    this.#value = value;
    guardedLocalStorage().setItem(KEY, String(value));
    for (const listener of this.#listeners) listener();
  }
}

export const keepAwakeStore = new KeepAwakeStore();

export function useKeepAwake(): boolean {
  return useSyncExternalStore(keepAwakeStore.subscribe, () => keepAwakeStore.value);
}

const lock = screenWakeLock();
const awake = lock === null ? null : new ScreenAwake(lock, document);
let screens = 0;
const sync = (): void => void awake?.want(keepAwakeStore.value && screens > 0);
keepAwakeStore.subscribe(sync);

/**
 * Whether the terminals in this subtree are on screen. Settings keeps the workspace mounted but hidden, so a terminal
 * there is still mounted while nothing of it shows: it must not hold the screen awake, and it takes the lock back when
 * the workspace shows again.
 */
export const TerminalsOnScreen = createContext(true);

/** Marks a terminal as on screen while it is mounted in a shown workspace, so the screen stays awake. */
export function useScreenAwake(): void {
  const onScreen = useContext(TerminalsOnScreen);
  useEffect(() => {
    if (!onScreen) return;
    screens += 1;
    sync();
    return () => {
      screens -= 1;
      sync();
    };
  }, [onScreen]);
}
