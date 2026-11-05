/** The last tab moved, counted so the strip can say where it went each time, even to the same place twice. */
export interface TabMove {
  readonly key: string;
  readonly count: number;
}

/**
 * Moves the tab `key` of the strip's order `keys` so that it ends at index `to`, and the move to say. A move that changes
 * nothing (a key the strip no longer shows, its own place, an index past either end) keeps `said` as it was, so
 * nothing is announced: the strip can hand over a tab that a document event took away in the same frame.
 */
export function moveTabTo(
  keys: readonly string[],
  said: TabMove | null,
  key: string,
  to: number,
): { readonly order: readonly string[]; readonly said: TabMove | null } {
  const from = keys.indexOf(key);
  if (from === -1 || from === to || !Number.isInteger(to) || to < 0 || to >= keys.length) return { order: keys, said };
  const order = keys.filter((each) => each !== key);
  order.splice(to, 0, key);
  return { order, said: { key, count: (said?.count ?? 0) + 1 } };
}
