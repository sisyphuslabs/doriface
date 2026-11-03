import type { Terminal } from "@doriface/protocol";
import { isLocalKey, type MachineIds, tabAddress, tabKey } from "./tab-keys.ts";

/** Open tabs by key (`tabKey`); `missing` holds tabs whose terminal left the feed, with the list read it left at. */
export interface KeyedTabs {
  readonly open: readonly string[];
  readonly active: string | null;
  readonly split: string | null;
  readonly missing: ReadonlyMap<string, number>;
}

export const NO_TABS: KeyedTabs = { open: [], active: null, split: null, missing: new Map() };

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

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
  const active = was(prev.active) ?? open[0] ?? null;
  const kept = was(prev.split);
  const split = kept !== null && kept !== active ? kept : null;
  const same =
    sameList(open, prev.open) && active === prev.active && split === prev.split && missing.size === prev.missing.size;
  return same ? prev : { open, active, split, missing };
}
