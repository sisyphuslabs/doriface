import type { Terminal } from "@doriface/protocol";
import { isLocalKey, type MachineIds, tabAddress, tabKey } from "./tab-keys.ts";

/** Open tabs by key (`tabKey`); `missing` holds tabs whose terminal left the feed, with the list read it left at. */
export interface KeyedTabs {
  readonly open: readonly string[];
  readonly active: string | null;
  readonly split: string | null;
  readonly missing: ReadonlyMap<string, number>;
  /** A tab asked for before the feed lists its terminal (New tab answers first): it opens, focused, once listed. */
  readonly pending: string | null;
}

export const NO_TABS: KeyedTabs = { open: [], active: null, split: null, missing: new Map(), pending: null };

/** The last tab moved, counted so the strip can say where it went each time, even to the same place twice. */
export interface TabMove {
  readonly address: string;
  readonly count: number;
}

/**
 * Moves the tab at `address` to slot `to` of the tabs whose machine is listed (a tab whose machine is not listed yet
 * holds its place without one), and the move to say. A move that changes nothing keeps `said` as it was, so nothing is
 * announced: for one frame while machine.list names a machine whose tab is still kept by name (`name:`), until
 * followTerminals re-keys it, the lookup by id misses.
 */
export function moveTabTo(
  prev: KeyedTabs,
  said: TabMove | null,
  address: string,
  to: number,
  ids: MachineIds,
): { readonly tabs: KeyedTabs; readonly said: TabMove | null } {
  const target = prev.open.filter((key) => tabAddress(key, ids) !== undefined)[to];
  const tabs = target === undefined ? prev : moveTab(prev, tabKey(address, ids), prev.open.indexOf(target));
  if (tabs === prev) return { tabs, said };
  return { tabs, said: { address, count: (said?.count ?? 0) + 1 } };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

const sameWaits = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean =>
  a.size === b.size && [...a].every(([key, at]) => b.get(key) === at);

/**
 * Open tabs follow live terminals. A local tab drops when its terminal goes. A tab on an added machine waits for the
 * next machine.list read before it drops: renaming a machine removes `old/t7` and creates `new/t7`, and only the list
 * says the two are one machine. `listed` counts the reads that came back.
 */
export function followTerminals(
  prev: KeyedTabs,
  terminals: readonly Terminal[],
  ids: MachineIds,
  listed: number,
): KeyedTabs {
  const known = new Set(terminals.map((terminal) => terminal.address));
  const renamed = new Map<string, string>();
  const missing = new Map<string, number>();
  for (const key of prev.open) {
    const address = tabAddress(key, ids);
    if (address !== undefined && known.has(address)) renamed.set(key, tabKey(address, ids));
    else if (!isLocalKey(key) && (prev.missing.get(key) ?? listed) === listed) {
      renamed.set(key, key);
      missing.set(key, listed);
    }
  }
  let open = [...renamed.values()];
  const firstLive = terminals.find((terminal) => terminal.state === "live")?.address;
  if (open.length === 0 && firstLive !== undefined) open = [tabKey(firstLive, ids)];
  const was = (key: string | null): string | null => (key === null ? null : (renamed.get(key) ?? null));
  const arrived = prev.pending === null ? undefined : tabAddress(prev.pending, ids);
  const next =
    arrived !== undefined && known.has(arrived) ? selectTab({ ...prev, open }, tabKey(arrived, ids), true) : null;
  if (next !== null) open = [...next.open];
  const active = next?.active ?? was(prev.active) ?? open[0] ?? null;
  const kept = was(prev.split);
  const split = kept !== null && kept !== active ? kept : null;
  const pending = next === null ? prev.pending : null;
  const same =
    sameList(open, prev.open) &&
    active === prev.active &&
    split === prev.split &&
    sameWaits(missing, prev.missing) &&
    pending === prev.pending;
  return same ? prev : { open, active, split, missing, pending };
}

/**
 * Opens the tab for `key` and makes it the active one. A terminal the feed does not list yet (`listed` false) is only
 * noted as pending: the current tab stays in front until followTerminals sees it listed, and a later selection
 * replaces it, so a terminal the feed never lists leaves nothing behind.
 */
export function selectTab(prev: KeyedTabs, key: string, listed: boolean): KeyedTabs {
  if (!listed) return { ...prev, pending: key };
  return {
    ...prev,
    open: prev.open.includes(key) ? prev.open : [...prev.open, key],
    active: key,
    split: prev.split === key ? null : prev.split,
    pending: null,
  };
}

/**
 * Moves the open tab `key` so that it ends at index `to`. Nothing else changes: the active tab, the split and which
 * terminals are shown stay as they are. An unknown key or an index outside the list leaves the tabs unchanged.
 */
export function moveTab(prev: KeyedTabs, key: string, to: number): KeyedTabs {
  const from = prev.open.indexOf(key);
  if (from === -1 || from === to || !Number.isInteger(to) || to < 0 || to >= prev.open.length) return prev;
  const open = prev.open.filter((entry) => entry !== key);
  open.splice(to, 0, key);
  return { ...prev, open };
}

/**
 * Selects the terminal at `address` against the feed as it is now (`listed`, null before the first answer): New tab
 * answers after the feed may already list its terminal, and then it opens at once instead of waiting for a later pass.
 */
export function selectTerminal(
  prev: KeyedTabs,
  address: string,
  ids: MachineIds,
  listed: readonly Terminal[] | null,
): KeyedTabs {
  const known = listed?.some((terminal) => terminal.address === address) ?? false;
  return selectTab(prev, tabKey(address, ids), known);
}
