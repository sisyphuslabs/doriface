import type { MachineView, Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { followTerminals, type KeyedTabs, NO_TABS, selectTab } from "./tab-follow.ts";
import { machineIds, tabAddress, tabKey } from "./tab-keys.ts";

export interface TabsState {
  readonly open: readonly string[];
  readonly active: string | null;
  /** The second pane of a split, or null for one pane. */
  readonly split: string | null;
}

export interface Tabs extends TabsState {
  select(address: string): void;
  /** Closing a tab as the person asked: the workspace asks first whether to keep the session running. */
  close(address: string): void;
  /** Removes the tab at once; the session keeps running. */
  drop(address: string): void;
  toggleSplit(): void;
  /** Marks a shown pane as the focused one. */
  focus(address: string): void;
}

/** Per core, so leaving the workspace (Settings, a reconnect) and coming back finds the same tabs. */
const kept = new Map<string, KeyedTabs>();

/**
 * Open tabs follow live terminals: a removed terminal drops its tab, the first live one opens by default.
 * `terminals` is null until the core has listed them; until then the kept tabs stand as they are. Tabs are kept by
 * machine id (`tabKey`), so renaming a machine moves its tabs to the new addresses instead of closing them; `listed`
 * counts machine.list reads, which is what tells a rename from a removal (`followTerminals`).
 */
export function useTabs(
  core: string,
  terminals: readonly Terminal[] | null,
  machines: readonly MachineView[],
  listed: number,
): Tabs {
  const ids = useMemo(() => machineIds(machines), [machines]);
  const [state, setState] = useState<KeyedTabs>(() => kept.get(core) ?? NO_TABS);

  useEffect(() => {
    kept.set(core, state);
  }, [core, state]);

  useEffect(() => {
    if (terminals === null) return;
    setState((prev) => followTerminals(prev, terminals, ids, listed));
  }, [terminals, ids, listed]);

  // What the feed lists now: New tab selects a terminal hc has started that the feed may not list yet.
  const listedNow = useMemo(() => new Set((terminals ?? []).map((terminal) => terminal.address)), [terminals]);
  const select = useCallback(
    (address: string) => setState((prev) => selectTab(prev, tabKey(address, ids), listedNow.has(address))),
    [ids, listedNow],
  );

  const close = useCallback(
    (address: string) => {
      const key = tabKey(address, ids);
      setState((prev) => {
        const open = prev.open.filter((entry) => entry !== key);
        const active = prev.active === key ? (open.at(-1) ?? null) : prev.active;
        const split = prev.split === key || prev.split === active ? null : prev.split;
        return { ...prev, open, active, split };
      });
    },
    [ids],
  );

  const toggleSplit = useCallback(() => {
    setState((prev) => {
      if (prev.split !== null) return { ...prev, split: null };
      const other = prev.open.find((key) => key !== prev.active);
      // The new pane takes focus, like a new split in Ghostty; the focused pane is the left one.
      return other === undefined ? prev : { ...prev, active: other, split: prev.active };
    });
  }, []);

  const focus = useCallback(
    (address: string) => {
      const key = tabKey(address, ids);
      setState((prev) => {
        if (prev.active === key || prev.split !== key) return prev;
        return { ...prev, active: key, split: prev.active };
      });
    },
    [ids],
  );

  const resolve = (key: string | null): string | null => (key === null ? null : (tabAddress(key, ids) ?? null));
  const open = state.open.flatMap((key) => tabAddress(key, ids) ?? []);
  return {
    open,
    active: resolve(state.active),
    split: resolve(state.split),
    select,
    close,
    drop: close,
    toggleSplit,
    focus,
  };
}
