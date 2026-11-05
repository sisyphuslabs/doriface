/** The Storage calls the app makes. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A Storage that never throws: storage refused by site settings or a sandbox (every access throws a SecurityError, as
 * Chromium does with cookies blocked) or missing altogether (bun's test runner) reads as empty and ignores writes, so
 * the app still starts (storage-refused.e2e.ts).
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

/** This page's sessionStorage, guarded; read through globalThis so a runtime without one gets the empty store. */
export const guardedSessionStorage = (): StorageLike =>
  guardedStorage(Reflect.get(globalThis, "sessionStorage") as StorageLike | undefined);
