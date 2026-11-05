/** The Storage calls the app makes. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StorageName = "localStorage" | "sessionStorage";

const failing = (error: unknown): StorageLike => {
  const fail = (): never => {
    throw error;
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
};

/**
 * The browser's own store, for a caller that must see why a write was refused (saveView reports it). Read through
 * globalThis: a runtime without one (bun's test runner), or one where touching it throws (Chromium with storage
 * blocked), gets a store whose every call throws that refusal.
 */
export function browserStorage(name: StorageName): StorageLike {
  try {
    const storage = Reflect.get(globalThis, name) as StorageLike | undefined;
    return storage ?? failing(new DOMException(`${name} is not available`, "SecurityError"));
  } catch (error) {
    return failing(error);
  }
}

/**
 * A Storage that never throws: storage refused by site settings or a sandbox (every access throws a SecurityError, as
 * Chromium does with cookies blocked) or missing altogether reads as empty and ignores writes, so the app still starts
 * (storage-refused.e2e.ts).
 */
export function guardedStorage(storage: StorageLike | undefined): StorageLike {
  return {
    getItem(key) {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        storage?.setItem(key, value);
      } catch {
        // A refused write keeps nothing; the caller goes on without it.
      }
    },
    removeItem(key) {
      try {
        storage?.removeItem(key);
      } catch {
        // As for a refused write.
      }
    },
  };
}

export const guardedLocalStorage = (): StorageLike => guardedStorage(browserStorage("localStorage"));
export const guardedSessionStorage = (): StorageLike => guardedStorage(browserStorage("sessionStorage"));
