import type { Terminal } from "@doriface/protocol";

/** An End the user confirmed that this browser has not seen through yet: the program, by address and pid. */
export interface PendingEnd {
  readonly address: string;
  readonly pid: number | null;
  /** When it was asked, in ms since the epoch. */
  readonly at: number;
}

/** A confirmed End older than this is not resumed: the session may have been reused long since. */
export const PENDING_END_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The Ends of one core this browser asked and has not seen settle, kept in local storage across page loads. */
export interface PendingEnds {
  add(end: PendingEnd): void;
  remove(address: string): void;
  /** The ones still young enough to resume, oldest first. */
  list(now?: number): readonly PendingEnd[];
}

const keyOf = (core: string): string => `doriface.pending-ends.v1.${core}`;

const isPendingEnd = (value: unknown): value is PendingEnd =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "address") === "string" &&
  typeof Reflect.get(value, "at") === "number" &&
  (Reflect.get(value, "pid") === null || typeof Reflect.get(value, "pid") === "number");

/** Reads `core`'s pending Ends from `storage`; a store that cannot be read or written keeps nothing (a private window). */
export function pendingEnds(core: string, storage: Storage | undefined = globalThis.localStorage): PendingEnds {
  const read = (): PendingEnd[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(keyOf(core)) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter(isPendingEnd) : [];
    } catch {
      return [];
    }
  };
  const write = (ends: readonly PendingEnd[]): void => {
    try {
      if (ends.length === 0) storage?.removeItem(keyOf(core));
      else storage?.setItem(keyOf(core), JSON.stringify(ends));
    } catch {
      // A full or refused store: the End still runs on this page, it only cannot outlive a page close.
    }
  };
  return {
    add: (end) => write([...read().filter((entry) => entry.address !== end.address), end]),
    remove: (address) => write(read().filter((entry) => entry.address !== address)),
    list: (now = Date.now()) =>
      read()
        .filter((entry) => now - entry.at <= PENDING_END_MAX_AGE_MS)
        .toSorted((a, b) => a.at - b.at),
  };
}

/**
 * What to do with a pending End once the core says what it holds at that address:
 * - `end`: the program it was asked for still runs; end it again.
 * - `remove`: it ended, but the terminal was not removed; remove it.
 * - `drop`: nothing left to do (gone, or another program runs there now, which the End was never about).
 */
export type Resume = "end" | "remove" | "drop";

export function resumeOf(end: PendingEnd, terminal: Pick<Terminal, "state" | "pid"> | null): Resume {
  if (terminal === null) return "drop";
  if (terminal.state !== "live") return "remove";
  return end.pid === null || terminal.pid === end.pid ? "end" : "drop";
}
