import type { Terminal } from "@doriface/protocol";

/**
 * An End the user confirmed that this browser has not seen through yet. The address alone is not the terminal: an added
 * machine's name can come to name another machine, so the record also keeps the program's pid and hc's creation time of
 * the terminal, and acts only where both still match.
 */
export interface PendingEnd {
  readonly address: string;
  readonly pid: number | null;
  /** The terminal's `created_ms`. */
  readonly created: number;
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
  typeof Reflect.get(value, "created") === "number" &&
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
 * - `end`: the very terminal it was asked about still runs its program; end it again.
 * - `remove`: that terminal's program ended, but the terminal was not removed; remove it.
 * - `drop`: anything else: the terminal is gone, another terminal or program is there now, or the record cannot say
 *   which program it was about. A pending End never acts on a terminal it cannot prove is the one asked about.
 */
export type Resume = "end" | "remove" | "drop";

export function resumeOf(end: PendingEnd, terminal: Pick<Terminal, "state" | "pid" | "created_ms"> | null): Resume {
  if (terminal === null || end.pid === null) return "drop";
  if (terminal.pid !== end.pid || terminal.created_ms !== end.created) return "drop";
  return terminal.state === "live" ? "end" : "remove";
}
